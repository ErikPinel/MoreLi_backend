import { DateTime } from 'luxon';
import { buildLessonCalendar, defaultWeeklyWindows, lessonZone } from './lesson-calendar.js';

describe('Israel-local teacher calendar',()=>{
  const now=DateTime.fromISO('2026-10-22T08:00',{zone:lessonZone});
  const input={slots:[],customized:false,location:{name:'Jerusalem',latitude:31.78,longitude:35.23},busy:[],duration:60,days:7,now};
  it('defaults to 09–21 and subtracts actual local Shabbat boundaries',()=>{
    expect(defaultWeeklyWindows().map(slot=>slot.day_of_week)).toEqual([0,1,2,3,4]);
    const calendar=buildLessonCalendar(input);
    expect(calendar.usesDefault).toBe(true);
    const sunday=calendar.days.find(day=>day.date==='2026-10-25')!;
    expect(sunday.times[0].time).toBe('09:00');
    expect(sunday.times.at(-1)?.time).toBe('20:00');
    expect(calendar.shabbat.length).toBeGreaterThan(0);
    for(const day of calendar.days)for(const time of day.times)for(const blocked of calendar.shabbat){
      expect(Date.parse(time.startAt)<Date.parse(blocked.endAt)&&Date.parse(time.endAt)>Date.parse(blocked.startAt)).toBe(false);
    }
    expect(calendar.days.find(day=>day.date==='2026-10-23')!.times.some(time=>time.time==='18:00')).toBe(false);
    expect(calendar.days.find(day=>day.date==='2026-10-24')!.times.some(time=>time.time==='12:00')).toBe(false);
    expect(calendar.days.find(day=>day.date==='2026-10-23')!.times).toEqual([]);
    expect(calendar.days.find(day=>day.date==='2026-10-24')!.times).toEqual([]);
  });
  it('preserves an explicitly empty or custom schedule',()=>{
    expect(buildLessonCalendar({...input,customized:true}).days.every(day=>!day.times.length)).toBe(true);
    const calendar=buildLessonCalendar({...input,customized:true,slots:[{day_of_week:0,start_time:'16:00:00',end_time:'18:00:00',is_active:true}],duration:90});
    expect(calendar.days.find(day=>day.date==='2026-10-25')!.times.map(time=>time.time)).toEqual(['16:00','16:30']);
  });
  it('removes accepted overlaps and uses winter Israel offsets after clock change',()=>{
    const calendar=buildLessonCalendar({...input,busy:[{requested_start_at:'2026-10-25T07:30:00Z',requested_end_at:'2026-10-25T08:30:00Z'}]});
    const sunday=calendar.days.find(day=>day.date==='2026-10-25')!;
    expect(sunday.times.some(time=>time.time==='09:00')).toBe(false);
    expect(sunday.times.find(time=>time.time==='11:00')?.startAt).toBe('2026-10-25T09:00:00.000Z');
  });
  it('clearly labels a fallback location instead of pretending coordinates are known',()=>{
    const calendar=buildLessonCalendar({...input,location:null});
    expect(calendar.locationFallback).toBe(true);expect(calendar.locationName).toBe('ירושלים');
  });
});