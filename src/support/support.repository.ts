import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { SupabaseService } from '../database/supabase.service.js';
import { CreateSupportTicketDto, ListSupportTicketsDto, ReplySupportTicketDto } from './support.dto.js';

@Injectable()
export class SupportRepository {
  constructor(private readonly supabase: SupabaseService) {}
  async create(userId:string,dto:CreateSupportTicketDto){
    if(dto.lessonId){
      if(dto.teacherId||dto.inquiryId||dto.reviewId)throw new BadRequestException('יש לבחור הקשר אחד לפנייה: שיעור, פנייה או תוכן מדווח.');
      const {data,error}=await this.supabase.client.rpc('create_lesson_support_ticket',{p_user_id:userId,p_request_key:dto.requestKey,p_category:dto.category,p_subject:dto.subject,p_message:dto.message,p_lesson_id:dto.lessonId});
      if(error)throwSupabaseError(error,'לא ניתן לפתוח פנייה לגבי השיעור. בדקו שהשיעור שלכם ושקטגוריית הפנייה היא תמיכה, תקלה או דיווח.');return data;
    }
    const {data,error}=await this.supabase.client.rpc('create_context_support_ticket',{p_user_id:userId,p_request_key:dto.requestKey,p_category:dto.category,p_subject:dto.subject,p_message:dto.message,p_teacher_id:dto.teacherId??null,p_inquiry_id:dto.inquiryId??null,p_review_id:dto.reviewId??null});
    if(error)throwSupabaseError(error,'לא ניתן לשמור את הפנייה לתמיכה');return data;
  }
  async list(userId:string,query:ListSupportTicketsDto,admin=false){
    const offset=(query.page-1)*query.limit;
    let request=this.supabase.client.from('support_tickets').select('*').order('updated_at',{ascending:false}).order('id').range(offset,offset+query.limit);
    if(!admin)request=request.eq('user_id',userId);
    if(query.status)request=request.eq('status',query.status);
    if(query.view==='actionable')request=request.in('status',['open','in_progress']);
    if(query.ticketId)request=request.eq('id',query.ticketId);
    const {data,error}=await request;if(error)throwSupabaseError(error,'לא ניתן לטעון פניות תמיכה');
    return {items:data.slice(0,query.limit),page:query.page,limit:query.limit,hasMore:data.length>query.limit};
  }
  async detail(userId:string,id:string,admin=false){
    let request=this.supabase.client.from('support_tickets').select('*').eq('id',id);if(!admin)request=request.eq('user_id',userId);
    const {data,error}=await request.maybeSingle();if(error)throwSupabaseError(error,'לא ניתן לטעון את הפנייה');if(!data)throw new NotFoundException('הפנייה לא נמצאה');
    const messages=await this.supabase.client.from('support_messages').select('id,body,author_role,created_at').eq('ticket_id',id).order('created_at').order('id');
    if(messages.error)throwSupabaseError(messages.error,'לא ניתן לטעון את השיחה');
    if(!admin)return {...data,messages:messages.data};
    // Lets admins review the author's Bit payment reports directly from a billing ticket.
    const requester=await this.supabase.client.from('teacher_profiles').select('id,slug').eq('user_id',data.user_id).maybeSingle();
    if(requester.error)throwSupabaseError(requester.error,'לא ניתן לטעון את פרטי המורה שפנה');
    return {...data,messages:messages.data,requester_teacher:requester.data??null};
  }
  async reply(userId:string,id:string,dto:ReplySupportTicketDto){
    const {data,error}=await this.supabase.client.rpc('reply_support_ticket',{p_actor_id:userId,p_ticket_id:id,p_body:dto.body,p_status:dto.status??null});
    if(error)throwSupabaseError(error,'לא ניתן לשלוח את המענה');return data;
  }
  async reopenPayment(userId:string,ticketId:string,paymentId:string){
    const {data,error}=await this.supabase.client.rpc('reopen_teacher_access_payment',{p_actor_id:userId,p_ticket_id:ticketId,p_payment_id:paymentId});
    if(error)throwSupabaseError(error,'לא ניתן לפתוח בדיקה מחדש. יש לוודא שהדיווח נדחה, שהפנייה שייכת למורה ושאין דיווח אחר שממתין לבדיקה.');
    return data;
  }
}