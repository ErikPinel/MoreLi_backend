export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type EmailJob = {
  id: string
  event_key: string
  event_type: string
  entity_id: string
  recipient_id: string | null
  audience: 'user' | 'student' | 'teacher' | 'admin'
  recipient_email: string | null
  payload: Json
  status: 'pending' | 'processing' | 'sent' | 'dead'
  attempts: number
  available_at: string
  locked_until: string | null
  lease_token: string | null
  last_error: string | null
  created_at: string
  sent_at: string | null
  provider?: string | null
  provider_message_id?: string | null
  provider_status?: string | null
  provider_event_at?: string | null
  rendered_message?: Json | null
}

export type LessonRecord = {
  id: string
  teacher_id: string
  student_id: string
  connection_inquiry_id: string
  source_inquiry_id: string | null
  request_key: string | null
  starts_at: string | null
  ends_at: string | null
  mode: 'online' | 'in_person' | null
  status: 'needs_scheduling' | 'scheduled' | 'completed' | 'cancelled' | 'no_show_reported'
  student_completed_at: string | null
  teacher_completed_at: string | null
  note: string | null
  revision: number
  created_at: string
  updated_at: string
}

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      lessons: {
        Row: LessonRecord
        Insert: Partial<LessonRecord> & Pick<LessonRecord, 'teacher_id' | 'student_id' | 'connection_inquiry_id' | 'status'>
        Update: Partial<LessonRecord>
        Relationships: [
          { foreignKeyName: 'lessons_teacher_id_fkey'; columns: ['teacher_id']; isOneToOne: false; referencedRelation: 'teacher_profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'lessons_student_id_fkey'; columns: ['student_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'lessons_connection_inquiry_id_fkey'; columns: ['connection_inquiry_id']; isOneToOne: false; referencedRelation: 'inquiries'; referencedColumns: ['id'] },
          { foreignKeyName: 'lessons_source_inquiry_id_fkey'; columns: ['source_inquiry_id']; isOneToOne: true; referencedRelation: 'inquiries'; referencedColumns: ['id'] }
        ]
      }
      cities: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          latitude: number | null
          longitude: number | null
          name_en: string
          name_he: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name_en: string
          name_he: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name_en?: string
          name_he?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_delivery_events: {
        Row: {
          event_id: string
          event_type: string
          occurred_at: string
          provider_message_id: string
          received_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          occurred_at: string
          provider_message_id: string
          received_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          occurred_at?: string
          provider_message_id?: string
          received_at?: string
        }
        Relationships: []
      }
      email_outbox: {
        Row: {
          attempts: number
          audience: string
          available_at: string
          created_at: string
          entity_id: string
          event_key: string
          event_type: string
          id: string
          last_error: string | null
          lease_token: string | null
          locked_until: string | null
          payload: Json
          provider: string | null
          provider_event_at: string | null
          provider_message_id: string | null
          provider_status: string | null
          recipient_email: string | null
          recipient_id: string | null
          rendered_message: Json | null
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          audience: string
          available_at?: string
          created_at?: string
          entity_id: string
          event_key: string
          event_type: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          locked_until?: string | null
          payload?: Json
          provider?: string | null
          provider_event_at?: string | null
          provider_message_id?: string | null
          provider_status?: string | null
          recipient_email?: string | null
          recipient_id?: string | null
          rendered_message?: Json | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          audience?: string
          available_at?: string
          created_at?: string
          entity_id?: string
          event_key?: string
          event_type?: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          locked_until?: string | null
          payload?: Json
          provider?: string | null
          provider_event_at?: string | null
          provider_message_id?: string | null
          provider_status?: string | null
          recipient_email?: string | null
          recipient_id?: string | null
          rendered_message?: Json | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          created_at: string
          reason: string
          recipient_hash: string
        }
        Insert: {
          created_at?: string
          reason: string
          recipient_hash: string
        }
        Update: {
          created_at?: string
          reason?: string
          recipient_hash?: string
        }
        Relationships: []
      }
      external_identities: {
        Row: {
          created_at: string
          profile_id: string
          provider: string
          subject: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          provider: string
          subject: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          provider?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_identities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          student_id: string
          teacher_id: string
        }
        Insert: {
          created_at?: string
          student_id: string
          teacher_id: string
        }
        Update: {
          created_at?: string
          student_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inquiries: {
        Row: {
          contact_sharing_consented_at: string | null
          created_at: string
          id: string
          lesson_mode: string | null
          lesson_note: string | null
          lesson_status: string | null
          lesson_updated_at: string | null
          message: string
          request_id: string | null
          requested_end_at: string | null
          requested_start_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["inquiry_status"]
          student_completed_at: string | null
          student_id: string
          teacher_completed_at: string | null
          teacher_id: string
          viewed_at: string | null
        }
        Insert: {
          contact_sharing_consented_at?: string | null
          created_at?: string
          id?: string
          lesson_mode?: string | null
          lesson_note?: string | null
          lesson_status?: string | null
          lesson_updated_at?: string | null
          message: string
          request_id?: string | null
          requested_end_at?: string | null
          requested_start_at?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["inquiry_status"]
          student_completed_at?: string | null
          student_id: string
          teacher_completed_at?: string | null
          teacher_id: string
          viewed_at?: string | null
        }
        Update: {
          contact_sharing_consented_at?: string | null
          created_at?: string
          id?: string
          lesson_mode?: string | null
          lesson_note?: string | null
          lesson_status?: string | null
          lesson_updated_at?: string | null
          message?: string
          request_id?: string | null
          requested_end_at?: string | null
          requested_start_at?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["inquiry_status"]
          student_completed_at?: string | null
          student_id?: string
          teacher_completed_at?: string | null
          teacher_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inquiries_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "student_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inquiries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inquiries_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      levels: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          name_en: string
          name_he: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          is_active?: boolean
          name_en: string
          name_he: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          name_en?: string
          name_he?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          availability_score: number
          budget_score: number
          created_at: string
          id: string
          location_score: number
          quality_score: number
          rank: number
          request_id: string
          score: number
          status: Database["public"]["Enums"]["match_status"]
          subject_score: number
          teacher_id: string
        }
        Insert: {
          availability_score: number
          budget_score: number
          created_at?: string
          id?: string
          location_score: number
          quality_score: number
          rank: number
          request_id: string
          score: number
          status?: Database["public"]["Enums"]["match_status"]
          subject_score: number
          teacher_id: string
        }
        Update: {
          availability_score?: number
          budget_score?: number
          created_at?: string
          id?: string
          location_score?: number
          quality_score?: number
          rank?: number
          request_id?: string
          score?: number
          status?: Database["public"]["Enums"]["match_status"]
          subject_score?: number
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "student_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          city_id: number | null
          contact_email: string | null
          created_at: string
          first_name: string
          id: string
          last_name: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          city_id?: number | null
          contact_email?: string | null
          created_at?: string
          first_name?: string
          id: string
          last_name?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          city_id?: number | null
          contact_email?: string | null
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body: string | null
          created_at: string
          id: string
          inquiry_id: string | null
          rating: number
          status: Database["public"]["Enums"]["review_status"]
          student_id: string
          teacher_id: string
          teacher_reply: string | null
          teacher_reply_at: string | null
          teacher_reply_status:
            | Database["public"]["Enums"]["review_status"]
            | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          inquiry_id?: string | null
          rating: number
          status?: Database["public"]["Enums"]["review_status"]
          student_id: string
          teacher_id: string
          teacher_reply?: string | null
          teacher_reply_at?: string | null
          teacher_reply_status?:
            | Database["public"]["Enums"]["review_status"]
            | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          inquiry_id?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["review_status"]
          student_id?: string
          teacher_id?: string
          teacher_reply?: string | null
          teacher_reply_at?: string | null
          teacher_reply_status?:
            | Database["public"]["Enums"]["review_status"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "inquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_requests: {
        Row: {
          budget_max: number | null
          budget_min: number | null
          city_id: number | null
          created_at: string
          desired_start_at: string | null
          goal: string
          id: string
          in_person_ok: boolean
          level_id: number | null
          notes: string | null
          online_ok: boolean
          status: Database["public"]["Enums"]["request_status"]
          student_id: string | null
          subject_id: number
          updated_at: string
        }
        Insert: {
          budget_max?: number | null
          budget_min?: number | null
          city_id?: number | null
          created_at?: string
          desired_start_at?: string | null
          goal: string
          id?: string
          in_person_ok?: boolean
          level_id?: number | null
          notes?: string | null
          online_ok?: boolean
          status?: Database["public"]["Enums"]["request_status"]
          student_id?: string | null
          subject_id: number
          updated_at?: string
        }
        Update: {
          budget_max?: number | null
          budget_min?: number | null
          city_id?: number | null
          created_at?: string
          desired_start_at?: string | null
          goal?: string
          id?: string
          in_person_ok?: boolean
          level_id?: number | null
          notes?: string | null
          online_ok?: boolean
          status?: Database["public"]["Enums"]["request_status"]
          student_id?: string | null
          subject_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_requests_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_requests_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_requests_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          name_en: string
          name_he: string
          parent_id: number | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          is_active?: boolean
          name_en: string
          name_he: string
          parent_id?: number | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          name_en?: string
          name_he?: string
          parent_id?: number | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          author_id: string | null
          author_role: string
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          author_id?: string | null
          author_role: string
          body: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          author_id?: string | null
          author_role?: string
          body?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          lesson_id: string | null
          workflow: string | null
          payment_id: string | null
          review_id: string | null
          category: string
          created_at: string
          id: string
          inquiry_id: string | null
          message: string
          request_key: string
          status: string
          subject: string
          teacher_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          lesson_id?: string | null
          workflow?: string | null
          payment_id?: string | null
          review_id?: string | null
          category: string
          created_at?: string
          id?: string
          inquiry_id?: string | null
          message: string
          request_key: string
          status?: string
          subject: string
          teacher_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          lesson_id?: string | null
          workflow?: string | null
          payment_id?: string | null
          review_id?: string | null
          category?: string
          created_at?: string
          id?: string
          inquiry_id?: string | null
          message?: string
          request_key?: string
          status?: string
          subject?: string
          teacher_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "inquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "teacher_access_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_access: {
        Row: {
          free_contact_used: boolean
          paid_until: string | null
          teacher_id: string
          updated_at: string
        }
        Insert: {
          free_contact_used?: boolean
          paid_until?: string | null
          teacher_id: string
          updated_at?: string
        }
        Update: {
          free_contact_used?: boolean
          paid_until?: string | null
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_access_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_access_payments: {
        Row: {
          amount_ils: number
          created_at: string
          id: string
          period_end_at: string | null
          period_start_at: string | null
          reference: string
          reconsideration_of: string | null
          support_ticket_id: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          teacher_id: string
          terms_accepted_at: string
          terms_version: string
        }
        Insert: {
          amount_ils?: number
          created_at?: string
          id?: string
          period_end_at?: string | null
          period_start_at?: string | null
          reference: string
          reconsideration_of?: string | null
          support_ticket_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          teacher_id: string
          terms_accepted_at?: string
          terms_version?: string
        }
        Update: {
          amount_ils?: number
          created_at?: string
          id?: string
          period_end_at?: string | null
          period_start_at?: string | null
          reference?: string
          reconsideration_of?: string | null
          support_ticket_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          teacher_id?: string
          terms_accepted_at?: string
          terms_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_access_payments_reconsideration_of_fkey"
            columns: ["reconsideration_of"]
            isOneToOne: true
            referencedRelation: "teacher_access_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_access_payments_support_ticket_id_fkey"
            columns: ["support_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_access_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_access_payments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_availability: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: number
          is_active: boolean
          start_time: string
          teacher_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: number
          is_active?: boolean
          start_time: string
          teacher_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: number
          is_active?: boolean
          start_time?: string
          teacher_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_availability_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_contact_grants: {
        Row: {
          granted_at: string
          student_id: string
          teacher_id: string
        }
        Insert: {
          granted_at?: string
          student_id: string
          teacher_id: string
        }
        Update: {
          granted_at?: string
          student_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_contact_grants_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_contact_grants_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_levels: {
        Row: {
          level_id: number
          teacher_id: string
        }
        Insert: {
          level_id: number
          teacher_id: string
        }
        Update: {
          level_id?: number
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_levels_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_levels_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_profiles: {
        Row: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }
        Insert: {
          availability_customized?: boolean
          average_rating?: number
          bio?: string
          claimed_at?: string | null
          created_at?: string
          currency?: string
          headline?: string
          hourly_price: number
          id?: string
          is_founder?: boolean
          profile_status?: Database["public"]["Enums"]["teacher_profile_status"]
          published_at?: string | null
          response_rate?: number
          response_time_minutes?: number | null
          review_count?: number
          review_reason?: string | null
          slug: string
          teaches_in_person?: boolean
          teaches_online?: boolean
          terms_accepted_at?: string | null
          updated_at?: string
          user_id: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          years_experience?: number
        }
        Update: {
          availability_customized?: boolean
          average_rating?: number
          bio?: string
          claimed_at?: string | null
          created_at?: string
          currency?: string
          headline?: string
          hourly_price?: number
          id?: string
          is_founder?: boolean
          profile_status?: Database["public"]["Enums"]["teacher_profile_status"]
          published_at?: string | null
          response_rate?: number
          response_time_minutes?: number | null
          review_count?: number
          review_reason?: string | null
          slug?: string
          teaches_in_person?: boolean
          teaches_online?: boolean
          terms_accepted_at?: string | null
          updated_at?: string
          user_id?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          years_experience?: number
        }
        Relationships: [
          {
            foreignKeyName: "teacher_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_review_audit: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          next_status: string
          previous_status: string
          reason: string | null
          teacher_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          next_status: string
          previous_status: string
          reason?: string | null
          teacher_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          next_status?: string
          previous_status?: string
          reason?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_review_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_review_audit_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_service_areas: {
        Row: {
          city_id: number
          teacher_id: string
        }
        Insert: {
          city_id: number
          teacher_id: string
        }
        Update: {
          city_id?: number
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_service_areas_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_service_areas_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_subjects: {
        Row: {
          description: string | null
          experience_years: number | null
          subject_id: number
          teacher_id: string
        }
        Insert: {
          description?: string | null
          experience_years?: number | null
          subject_id: number
          teacher_id: string
        }
        Update: {
          description?: string | null
          experience_years?: number | null
          subject_id?: number
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_subjects_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      save_teacher_lesson: {
        Args: { p_actor: string; p_request_key: string | null; p_student: string; p_start: string; p_end: string; p_mode: string; p_lesson_id?: string | null }
        Returns: LessonRecord[]
      }
      update_scheduled_lesson_state: {
        Args: { p_user_id: string; p_lesson_id: string; p_action: string; p_note: string }
        Returns: LessonRecord[]
      }
      create_lesson_support_ticket: {
        Args: { p_user_id: string; p_request_key: string; p_category: string; p_subject: string; p_message: string; p_lesson_id: string }
        Returns: Json
      }
      approve_teacher_review: {
        Args: { p_teacher_id: string }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      approve_teacher_review_by_admin: {
        Args: { p_actor_id: string; p_teacher_id: string }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_email_jobs: {
        Args: { p_limit?: number }
        Returns: EmailJob[]
        SetofOptions: {
          from: "*"
          to: "email_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_teacher_access_payment: {
        Args: { p_reference: string; p_terms: boolean; p_user_id: string }
        Returns: Json
      }
      count_teacher_candidates_v2: {
        Args: {
          p_budget_max?: number
          p_budget_min?: number
          p_city_id?: number
          p_in_person_ok?: boolean
          p_level_id?: number
          p_online_ok?: boolean
          p_rating_min?: number
          p_subject_id?: number
          p_verified_only?: boolean
        }
        Returns: number
      }
      create_inquiry: {
        Args: {
          p_lesson_mode?: string
          p_message: string
          p_request_id: string
          p_requested_end_at?: string
          p_requested_start_at?: string
          p_student_id: string
          p_teacher_id: string
        }
        Returns: {
          contact_sharing_consented_at: string | null
          created_at: string
          id: string
          lesson_mode: string | null
          lesson_note: string | null
          lesson_status: string | null
          lesson_updated_at: string | null
          message: string
          request_id: string | null
          requested_end_at: string | null
          requested_start_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["inquiry_status"]
          student_completed_at: string | null
          student_id: string
          teacher_completed_at: string | null
          teacher_id: string
          viewed_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "inquiries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_support_ticket: {
        Args: {
          p_category: string
          p_inquiry_id?: string | null
          p_message: string
          p_request_key: string
          p_subject: string
          p_teacher_id?: string | null
          p_user_id: string
        }
        Returns: Json
      }
      create_context_support_ticket: {
        Args: {
          p_category: string
          p_inquiry_id?: string | null
          p_message: string
          p_request_key: string
          p_subject: string
          p_teacher_id?: string | null
          p_review_id?: string | null
          p_user_id: string
        }
        Returns: Json
      }
      create_teacher_draft: {
        Args: { p_slug: string; p_terms_accepted: boolean; p_user_id: string }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      delete_owned_review: {
        Args: { p_review_id: string; p_student_id: string }
        Returns: boolean
      }
      edit_owned_review: {
        Args: {
          p_body: string
          p_rating: number
          p_review_id: string
          p_student_id: string
        }
        Returns: {
          body: string | null
          created_at: string
          id: string
          inquiry_id: string | null
          rating: number
          status: Database["public"]["Enums"]["review_status"]
          student_id: string
          teacher_id: string
          teacher_reply: string | null
          teacher_reply_at: string | null
          teacher_reply_status:
            | Database["public"]["Enums"]["review_status"]
            | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_marketplace_email: {
        Args: {
          p_audience: string
          p_entity: string
          p_key: string
          p_kind: string
          p_payload: Json
          p_recipient: string
        }
        Returns: undefined
      }
      expire_stale_inquiries: { Args: never; Returns: number }
      finish_email_job: {
        Args: { p_id: string; p_lease: string; p_success: boolean }
        Returns: boolean
      }
      finish_resend_job: {
        Args: {
          p_error_code: string | null
          p_id: string
          p_lease: string
          p_message_id: string | null
          p_retry_after?: number | null
          p_retryable: boolean
          p_success: boolean
        }
        Returns: boolean
      }
      mark_inquiry_viewed: {
        Args: { p_inquiry_id: string; p_teacher_user_id: string }
        Returns: {
          contact_sharing_consented_at: string | null
          created_at: string
          id: string
          lesson_mode: string | null
          lesson_note: string | null
          lesson_status: string | null
          lesson_updated_at: string | null
          message: string
          request_id: string | null
          requested_end_at: string | null
          requested_start_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["inquiry_status"]
          student_completed_at: string | null
          student_id: string
          teacher_completed_at: string | null
          teacher_id: string
          viewed_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "inquiries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      moderate_review: {
        Args: {
          p_review_id: string
          p_status: Database["public"]["Enums"]["review_status"]
        }
        Returns: {
          body: string | null
          created_at: string
          id: string
          inquiry_id: string | null
          rating: number
          status: Database["public"]["Enums"]["review_status"]
          student_id: string
          teacher_id: string
          teacher_reply: string | null
          teacher_reply_at: string | null
          teacher_reply_status:
            | Database["public"]["Enums"]["review_status"]
            | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      moderate_review_reply: {
        Args: {
          p_actor_id: string
          p_review_id: string
          p_status: Database["public"]["Enums"]["review_status"]
        }
        Returns: {
          body: string | null
          created_at: string
          id: string
          inquiry_id: string | null
          rating: number
          status: Database["public"]["Enums"]["review_status"]
          student_id: string
          teacher_id: string
          teacher_reply: string | null
          teacher_reply_at: string | null
          teacher_reply_status:
            | Database["public"]["Enums"]["review_status"]
            | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      moderate_teacher: {
        Args: {
          p_profile_status?: Database["public"]["Enums"]["teacher_profile_status"]
          p_teacher_id: string
          p_verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      persist_matches: {
        Args: { p_matches: Json; p_request_id: string }
        Returns: {
          availability_score: number
          budget_score: number
          created_at: string
          id: string
          location_score: number
          quality_score: number
          rank: number
          request_id: string
          score: number
          status: Database["public"]["Enums"]["match_status"]
          subject_score: number
          teacher_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      prepare_email_job: {
        Args: { p_id: string; p_lease: string; p_message: Json }
        Returns: Json
      }
      record_resend_event: {
        Args: {
          p_event_id: string
          p_job_id?: string | null
          p_message_id: string
          p_occurred_at: string
          p_type: string
        }
        Returns: boolean
      }
      reject_teacher_review: {
        Args: { p_actor_id: string; p_reason: string; p_teacher_id: string }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      replace_professions: {
        Args: { p_professions: Json }
        Returns: {
          active_count: number
          deleted_count: number
          retained_inactive_count: number
        }[]
      }
      replace_teacher_availability: {
        Args: { p_slots: Json; p_teacher_id: string }
        Returns: {
          created_at: string
          day_of_week: number
          end_time: string
          id: number
          is_active: boolean
          start_time: string
          teacher_id: string
          timezone: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_availability"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      replace_teacher_levels: {
        Args: { p_level_ids: number[]; p_teacher_id: string }
        Returns: {
          level_id: number
          teacher_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_levels"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      replace_teacher_service_areas: {
        Args: { p_city_ids: number[]; p_teacher_id: string }
        Returns: {
          city_id: number
          teacher_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_service_areas"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      replace_teacher_subjects: {
        Args: { p_subjects: Json; p_teacher_id: string }
        Returns: {
          description: string | null
          experience_years: number | null
          subject_id: number
          teacher_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_subjects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reply_support_ticket: {
        Args: {
          p_actor_id: string
          p_body: string
          p_status?: string | null
          p_ticket_id: string
        }
        Returns: Json
      }
      reply_to_review: {
        Args: { p_body: string | null; p_review_id: string; p_teacher_user_id: string }
        Returns: {
          body: string | null
          created_at: string
          id: string
          inquiry_id: string | null
          rating: number
          status: Database["public"]["Enums"]["review_status"]
          student_id: string
          teacher_id: string
          teacher_reply: string | null
          teacher_reply_at: string | null
          teacher_reply_status:
            | Database["public"]["Enums"]["review_status"]
            | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      resolve_external_identity: {
        Args: {
          p_first_name?: string
          p_last_name?: string
          p_provider: string
          p_subject: string
        }
        Returns: string
      }
      respond_to_inquiry: {
        Args: {
          p_inquiry_id: string
          p_status: Database["public"]["Enums"]["inquiry_status"]
          p_teacher_user_id: string
        }
        Returns: {
          contact_sharing_consented_at: string | null
          created_at: string
          id: string
          lesson_mode: string | null
          lesson_note: string | null
          lesson_status: string | null
          lesson_updated_at: string | null
          message: string
          request_id: string | null
          requested_end_at: string | null
          requested_start_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["inquiry_status"]
          student_completed_at: string | null
          student_id: string
          teacher_completed_at: string | null
          teacher_id: string
          viewed_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "inquiries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reopen_teacher_access_payment: {
        Args: { p_actor_id: string; p_payment_id: string; p_ticket_id: string }
        Returns: Json
      }
      review_teacher_access_payment: {
        Args: {
          p_actor_id: string
          p_approve: boolean
          p_note: string
          p_payment_id: string
        }
        Returns: Json
      }
      save_teacher_profile: {
        Args: { p_form: Json; p_submit_review?: boolean; p_user_id: string }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_teacher_candidates: {
        Args: {
          p_budget_max?: number
          p_budget_min?: number
          p_city_id?: number
          p_in_person_ok?: boolean
          p_level_id?: number
          p_limit?: number
          p_offset?: number
          p_online_ok?: boolean
          p_subject_id?: number
        }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_teacher_candidates_v2: {
        Args: {
          p_budget_max?: number
          p_budget_min?: number
          p_city_id?: number
          p_in_person_ok?: boolean
          p_level_id?: number
          p_limit?: number
          p_offset?: number
          p_online_ok?: boolean
          p_rating_min?: number
          p_sort?: string
          p_subject_id?: number
          p_verified_only?: boolean
        }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_teacher_schedule: {
        Args: { p_slots: Json; p_teacher_id: string }
        Returns: {
          created_at: string
          day_of_week: number
          end_time: string
          id: number
          is_active: boolean
          start_time: string
          teacher_id: string
          timezone: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_availability"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      submit_teacher_for_review: {
        Args: { p_teacher_id: string; p_user_id: string }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      submit_teacher_onboarding: {
        Args: { p_form: Json; p_user_id: string }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      submit_teacher_review: {
        Args: { p_student_id: string; p_teacher_id: string; p_rating: number; p_body: string }
        Returns: Database["public"]["Tables"]["reviews"]["Row"][]
      }
      submit_verified_review: {
        Args: {
          p_body: string
          p_inquiry_id: string
          p_rating: number
          p_student_id: string
        }
        Returns: {
          body: string | null
          created_at: string
          id: string
          inquiry_id: string | null
          rating: number
          status: Database["public"]["Enums"]["review_status"]
          student_id: string
          teacher_id: string
          teacher_reply: string | null
          teacher_reply_at: string | null
          teacher_reply_status:
            | Database["public"]["Enums"]["review_status"]
            | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      teacher_access_summary: { Args: { p_user_id: string }; Returns: Json }
      teacher_candidate_pool: {
        Args: {
          p_budget_max: number
          p_budget_min: number
          p_city_id: number
          p_in_person_ok: boolean
          p_online_ok: boolean
          p_rating_min: number
          p_subject_id: number
          p_verified_only: boolean
        }
        Returns: {
          availability_customized: boolean
          average_rating: number
          bio: string
          claimed_at: string | null
          created_at: string
          currency: string
          headline: string
          hourly_price: number
          id: string
          is_founder: boolean
          profile_status: Database["public"]["Enums"]["teacher_profile_status"]
          published_at: string | null
          response_rate: number
          response_time_minutes: number | null
          review_count: number
          review_reason: string | null
          slug: string
          teaches_in_person: boolean
          teaches_online: boolean
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          years_experience: number
        }[]
        SetofOptions: {
          from: "*"
          to: "teacher_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      teacher_matches_subject: {
        Args: { p_subject_id: number; p_teacher_id: string }
        Returns: boolean
      }
      update_lesson_state: {
        Args: {
          p_action: string
          p_inquiry_id: string
          p_note: string
          p_user_id: string
        }
        Returns: {
          contact_sharing_consented_at: string | null
          created_at: string
          id: string
          lesson_mode: string | null
          lesson_note: string | null
          lesson_status: string | null
          lesson_updated_at: string | null
          message: string
          request_id: string | null
          requested_end_at: string | null
          requested_start_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["inquiry_status"]
          student_completed_at: string | null
          student_id: string
          teacher_completed_at: string | null
          teacher_id: string
          viewed_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "inquiries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      inquiry_status: "sent" | "viewed" | "accepted" | "declined" | "expired"
      match_status: "suggested" | "viewed" | "contacted" | "dismissed"
      notification_type:
        | "inquiry_received"
        | "inquiry_accepted"
        | "inquiry_declined"
        | "inquiry_expired"
        | "review_received"
        | "teacher_verified"
        | "teacher_suspended"
        | "billing_updated"
        | "lesson_updated"
        | "support_updated"
      request_status: "draft" | "open" | "matched" | "closed" | "cancelled"
      review_status: "pending" | "published" | "rejected"
      teacher_profile_status: "draft" | "pending" | "published" | "suspended"
      user_role: "student" | "teacher" | "admin"
      verification_status: "unverified" | "pending" | "verified"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      inquiry_status: ["sent", "viewed", "accepted", "declined", "expired"],
      match_status: ["suggested", "viewed", "contacted", "dismissed"],
      notification_type: [
        "inquiry_received",
        "inquiry_accepted",
        "inquiry_declined",
        "inquiry_expired",
        "review_received",
        "teacher_verified",
        "teacher_suspended",
        "billing_updated",
        "lesson_updated",
        "support_updated",
      ],
      request_status: ["draft", "open", "matched", "closed", "cancelled"],
      review_status: ["pending", "published", "rejected"],
      teacher_profile_status: ["draft", "pending", "published", "suspended"],
      user_role: ["student", "teacher", "admin"],
      verification_status: ["unverified", "pending", "verified"],
    },
  },
} as const
