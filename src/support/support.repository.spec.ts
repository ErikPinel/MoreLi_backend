import { Test } from '@nestjs/testing';
import { SupabaseService } from '../database/supabase.service.js';
import { SupportRepository } from './support.repository.js';
import { ListSupportTicketsDto } from './support.dto.js';

describe('Admin billing ticket requester lookup', () => {
  const ticket = { id: 'ticket', user_id: 'requester-user', category: 'billing', teacher_id: 'reported-teacher' };
  const requester = { id: 'requester-teacher', slug: 'requester-teacher' };
  const tickets = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(), order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), data: [], error: null };
  const teachers = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn() };
  const messages = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn() };
  const rpc = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === 'support_tickets') return tickets;
    if (table === 'support_messages') return messages;
    if (table === 'teacher_profiles') return teachers;
    throw new Error(`Unexpected table: ${table}`);
  });
  let repository: SupportRepository;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [SupportRepository, { provide: SupabaseService, useValue: { client: { from, rpc } } }],
    }).compile();
    repository = module.get(SupportRepository);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    tickets.maybeSingle.mockResolvedValue({ data: ticket, error: null });
    teachers.maybeSingle.mockResolvedValue({ data: requester, error: null });
    messages.order.mockReturnValueOnce(messages).mockResolvedValueOnce({ data: [], error: null });
  });

  it('resolves the ticket author, not the optional teacher reported by the ticket', async () => {
    expect(await repository.detail('admin', ticket.id, true)).toMatchObject({ requester_teacher: requester });
    expect(teachers.eq).toHaveBeenCalledWith('user_id', ticket.user_id);
    expect(teachers.eq).not.toHaveBeenCalledWith('id', ticket.teacher_id);
  });
  it('returns an explicit null only when the database finds no teacher profile', async () => {
    teachers.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await repository.detail('admin', ticket.id, true)).toMatchObject({ requester_teacher: null });
  });
  it('does not turn lookup failures into a false non-teacher result', async () => {
    teachers.maybeSingle.mockResolvedValue({ data: null, error: { code: '08006' } });
    await expect(repository.detail('admin', ticket.id, true)).rejects.toThrow('לא ניתן לטעון את פרטי המורה שפנה');
  });
  it('does not add admin lookup data to owner ticket details', async () => {
    expect(await repository.detail(ticket.user_id, ticket.id)).not.toHaveProperty('requester_teacher');
    expect(teachers.maybeSingle).not.toHaveBeenCalled();
  });
  it('passes the authenticated admin and both validated record IDs to the atomic reconsideration RPC', async () => {
    rpc.mockResolvedValue({ data: { id: 'new-review' }, error: null });
    expect(await repository.reopenPayment('admin', ticket.id, 'rejected-payment')).toEqual({ id: 'new-review' });
    expect(rpc).toHaveBeenCalledWith('reopen_teacher_access_payment', { p_actor_id: 'admin', p_ticket_id: ticket.id, p_payment_id: 'rejected-payment' });
  });
  it('passes report context to the validating RPC rather than writing context separately',async()=>{
    rpc.mockResolvedValue({data:{id:'context-ticket'},error:null});
    await repository.create('reporter',{requestKey:'key',category:'report',subject:'Review report',message:'Please investigate this content',reviewId:'review-id'});
    expect(rpc).toHaveBeenCalledWith('create_context_support_ticket',{p_user_id:'reporter',p_request_key:'key',p_category:'report',p_subject:'Review report',p_message:'Please investigate this content',p_review_id:'review-id',p_teacher_id:null,p_inquiry_id:null});
  });
  it('excludes waiting and closed cases from the actionable queue while keeping owner scope',async()=>{
    await repository.list('owner',{...new ListSupportTicketsDto(),view:'actionable'});
    expect(tickets.in).toHaveBeenCalledWith('status',['open','in_progress']);
    expect(tickets.eq).toHaveBeenCalledWith('user_id','owner');
    vi.clearAllMocks();
    await repository.list('admin',{...new ListSupportTicketsDto(),status:'waiting_customer'},true);
    expect(tickets.eq).toHaveBeenCalledWith('status','waiting_customer');
    expect(tickets.eq).not.toHaveBeenCalledWith('user_id','admin');
    expect(tickets.in).not.toHaveBeenCalled();
  });
});
