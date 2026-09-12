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
}

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      email_outbox: {
        Row: EmailJob
        Insert: Omit<EmailJob, 'id'> & { id?: string }
        Update: Partial<EmailJob>
        Relationships: []
      }
      teacher_review_audit: {
        Row: { id: string; teacher_id: string; actor_id: string | null; previous_status: string; next_status: string; reason: string | null; created_at: string }
        Insert: { teacher_id: string; actor_id?: string | null; previous_status: string; next_status: string; reason?: string | null }
        Update: { reason?: string | null }
        Relationships: []
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
          created_at: string
          id: string
          lesson_mode: string | null
          message: string
          request_id: string | null
          requested_end_at: string | null
          requested_start_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["inquiry_status"]
          student_id: string
          teacher_id: string
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_mode?: string | null
          message: string
          request_id?: string | null
          requested_end_at?: string | null
          requested_start_at?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["inquiry_status"]
          student_id: string
          teacher_id: string
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lesson_mode?: string | null
          message?: string
          request_id?: string | null
          requested_end_at?: string | null
          requested_start_at?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["inquiry_status"]
          student_id?: string
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
          review_reason: string | null
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
      submit_teacher_onboarding: {
        Args: { p_user_id: string; p_form: Json };
        Returns: Database['public']['Tables']['teacher_profiles']['Row'][];
      };
      claim_email_jobs: { Args: { p_limit?: number }; Returns: EmailJob[] }
      finish_email_job: { Args: { p_id: string; p_lease: string; p_success: boolean }; Returns: boolean }
      reject_teacher_review: { Args: { p_teacher_id: string; p_actor_id: string; p_reason: string }; Returns: Database['public']['Tables']['teacher_profiles']['Row'][] }
      approve_teacher_review_by_admin: { Args: { p_teacher_id: string; p_actor_id: string }; Returns: Database['public']['Tables']['teacher_profiles']['Row'][] }
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
          created_at: string
          id: string
          lesson_mode: string | null
          message: string
          request_id: string | null
          requested_end_at: string | null
          requested_start_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["inquiry_status"]
          student_id: string
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
      resolve_external_identity: {
        Args: {
          p_first_name?: string
          p_last_name?: string
          p_provider: string
          p_subject: string
        }
        Returns: string
      }
      create_teacher_draft: {
        Args: { p_slug: string; p_terms_accepted: boolean; p_user_id: string }
        Returns: {
          review_reason: string | null
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
      expire_stale_inquiries: { Args: never; Returns: number }
      mark_inquiry_viewed: {
        Args: { p_inquiry_id: string; p_teacher_user_id: string }
        Returns: {
          created_at: string
          id: string
          lesson_mode: string | null
          message: string
          request_id: string | null
          requested_end_at: string | null
          requested_start_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["inquiry_status"]
          student_id: string
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
          review_reason: string | null
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
      approve_teacher_review: {
        Args: { p_teacher_id: string }
        Returns: {
          review_reason: string | null
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
      submit_teacher_for_review: {
        Args: { p_teacher_id: string; p_user_id: string }
        Returns: {
          review_reason: string | null
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
      replace_professions: {
        Args: { p_professions: Json }
        Returns: {
          active_count: number
          deleted_count: number
          retained_inactive_count: number
        }[]
      }
      respond_to_inquiry: {
        Args: {
          p_inquiry_id: string
          p_status: Database["public"]["Enums"]["inquiry_status"]
          p_teacher_user_id: string
        }
        Returns: {
          created_at: string
          id: string
          lesson_mode: string | null
          message: string
          request_id: string | null
          requested_end_at: string | null
          requested_start_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["inquiry_status"]
          student_id: string
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
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reviews"
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
      ],
      request_status: ["draft", "open", "matched", "closed", "cancelled"],
      review_status: ["pending", "published", "rejected"],
      teacher_profile_status: ["draft", "pending", "published", "suspended"],
      user_role: ["student", "teacher", "admin"],
      verification_status: ["unverified", "pending", "verified"],
    },
  },
} as const
