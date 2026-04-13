export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_configs: {
        Row: {
          agent_name: string
          briefing_hour: number | null
          created_at: string
          custom_instructions: string | null
          daily_briefing_enabled: boolean | null
          greeting_message: string | null
          id: string
          is_active: boolean
          language: string
          module_agenda: boolean
          module_chat: boolean
          module_finance: boolean
          module_habits: boolean
          module_notes: boolean
          monthly_report: boolean
          proactive_insights_enabled: boolean
          system_prompt: string | null
          template_event: string | null
          template_expense: string | null
          template_expense_multi: string | null
          template_income: string | null
          template_note: string | null
          tone: string
          updated_at: string
          user_id: string
          user_nickname: string | null
          weekly_report: boolean
        }
        Insert: {
          agent_name?: string
          briefing_hour?: number | null
          created_at?: string
          custom_instructions?: string | null
          daily_briefing_enabled?: boolean | null
          greeting_message?: string | null
          id?: string
          is_active?: boolean
          language?: string
          module_agenda?: boolean
          module_chat?: boolean
          module_finance?: boolean
          module_habits?: boolean
          module_notes?: boolean
          monthly_report?: boolean
          proactive_insights_enabled?: boolean
          system_prompt?: string | null
          template_event?: string | null
          template_expense?: string | null
          template_expense_multi?: string | null
          template_income?: string | null
          template_note?: string | null
          tone?: string
          updated_at?: string
          user_id: string
          user_nickname?: string | null
          weekly_report?: boolean
        }
        Update: {
          agent_name?: string
          briefing_hour?: number | null
          created_at?: string
          custom_instructions?: string | null
          daily_briefing_enabled?: boolean | null
          greeting_message?: string | null
          id?: string
          is_active?: boolean
          language?: string
          module_agenda?: boolean
          module_chat?: boolean
          module_finance?: boolean
          module_habits?: boolean
          module_notes?: boolean
          monthly_report?: boolean
          proactive_insights_enabled?: boolean
          system_prompt?: string | null
          template_event?: string | null
          template_expense?: string | null
          template_expense_multi?: string | null
          template_income?: string | null
          template_note?: string | null
          tone?: string
          updated_at?: string
          user_id?: string
          user_nickname?: string | null
          weekly_report?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      bot_metrics: {
        Row: {
          created_at: string
          error_type: string | null
          id: string
          intent: string
          message_length: number | null
          processing_time_ms: number | null
          success: boolean
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_type?: string | null
          id?: string
          intent?: string
          message_length?: number | null
          processing_time_ms?: number | null
          success?: boolean
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_type?: string | null
          id?: string
          intent?: string
          message_length?: number | null
          processing_time_ms?: number | null
          success?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          alert_at_percent: number
          amount_limit: number
          category: string
          created_at: string
          id: string
          last_alert_date: string | null
          period: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_at_percent?: number
          amount_limit: number
          category?: string
          created_at?: string
          id?: string
          last_alert_date?: string | null
          period?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_at_percent?: number
          amount_limit?: number
          category?: string
          created_at?: string
          id?: string
          last_alert_date?: string | null
          period?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          is_default: boolean
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          is_default?: boolean
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          is_default?: boolean
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          contact_name: string | null
          id: string
          last_message_at: string | null
          message_count: number
          phone_number: string
          started_at: string
          summary: string | null
          user_id: string
          whatsapp_lid: string | null
        }
        Insert: {
          contact_name?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          phone_number: string
          started_at?: string
          summary?: string | null
          user_id: string
          whatsapp_lid?: string | null
        }
        Update: {
          contact_name?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          phone_number?: string
          started_at?: string
          summary?: string | null
          user_id?: string
          whatsapp_lid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      debug_logs: {
        Row: {
          created_at: string | null
          id: number
          message: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          message?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          message?: string | null
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          context: string
          created_at: string
          id: string
          message: string
          metadata: Json | null
          phone_number: string | null
          severity: string
          stack: string | null
          user_id: string | null
        }
        Insert: {
          context: string
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          phone_number?: string | null
          severity?: string
          stack?: string | null
          user_id?: string | null
        }
        Update: {
          context?: string
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          phone_number?: string | null
          severity?: string
          stack?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          end_time: string | null
          event_date: string
          event_time: string | null
          event_type: string | null
          google_event_id: string | null
          id: string
          location: string | null
          needs_followup: boolean | null
          priority: string | null
          recurrence_parent_id: string | null
          reminder: boolean
          reminder_minutes_before: number | null
          source: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          event_date: string
          event_time?: string | null
          event_type?: string | null
          google_event_id?: string | null
          id?: string
          location?: string | null
          needs_followup?: boolean | null
          priority?: string | null
          recurrence_parent_id?: string | null
          reminder?: boolean
          reminder_minutes_before?: number | null
          source?: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          event_date?: string
          event_time?: string | null
          event_type?: string | null
          google_event_id?: string | null
          id?: string
          location?: string | null
          needs_followup?: boolean | null
          priority?: string | null
          recurrence_parent_id?: string | null
          reminder?: boolean
          reminder_minutes_before?: number | null
          source?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_logs: {
        Row: {
          habit_id: string
          id: string
          logged_at: string
          logged_date: string
          note: string | null
          user_id: string
        }
        Insert: {
          habit_id: string
          id?: string
          logged_at?: string
          logged_date?: string
          note?: string | null
          user_id: string
        }
        Update: {
          habit_id?: string
          id?: string
          logged_at?: string
          logged_date?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          best_streak: number
          color: string
          created_at: string
          current_streak: number
          description: string | null
          frequency: string
          habit_config: Json
          icon: string
          id: string
          is_active: boolean
          name: string
          preset_key: string | null
          reminder_times: Json
          target_days: Json
          times_per_day: number
          updated_at: string
          user_id: string
        }
        Insert: {
          best_streak?: number
          color?: string
          created_at?: string
          current_streak?: number
          description?: string | null
          frequency?: string
          habit_config?: Json
          icon?: string
          id?: string
          is_active?: boolean
          name: string
          preset_key?: string | null
          reminder_times?: Json
          target_days?: Json
          times_per_day?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          best_streak?: number
          color?: string
          created_at?: string
          current_streak?: number
          description?: string | null
          frequency?: string
          habit_config?: Json
          icon?: string
          id?: string
          is_active?: boolean
          name?: string
          preset_key?: string | null
          reminder_times?: Json
          target_days?: Json
          times_per_day?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          access_token: string | null
          connected_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_connected: boolean
          metadata: Json | null
          provider: string
          refresh_token: string | null
          user_id: string
        }
        Insert: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_connected?: boolean
          metadata?: Json | null
          provider: string
          refresh_token?: string | null
          user_id: string
        }
        Update: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_connected?: boolean
          metadata?: Json | null
          provider?: string
          refresh_token?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kirvano_events: {
        Row: {
          access_until: string | null
          amount: number | null
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          event_id: string | null
          event_type: string
          id: string
          matched_user_id: string | null
          processed_at: string | null
          product_name: string | null
          raw_payload: Json | null
          status: string | null
          subscription_id: string | null
          transaction_id: string | null
        }
        Insert: {
          access_until?: string | null
          amount?: number | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          event_id?: string | null
          event_type: string
          id?: string
          matched_user_id?: string | null
          processed_at?: string | null
          product_name?: string | null
          raw_payload?: Json | null
          status?: string | null
          subscription_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          access_until?: string | null
          amount?: number | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          event_id?: string | null
          event_type?: string
          id?: string
          matched_user_id?: string | null
          processed_at?: string | null
          product_name?: string | null
          raw_payload?: Json | null
          status?: string | null
          subscription_id?: string | null
          transaction_id?: string | null
        }
        Relationships: []
      }
      kirvano_payments: {
        Row: {
          amount: number | null
          created_at: string
          email: string
          id: string
          kirvano_order_id: string
          name: string | null
          phone: string | null
          plan: string
          status: string
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          email: string
          id?: string
          kirvano_order_id: string
          name?: string | null
          phone?: string | null
          plan?: string
          status: string
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          email?: string
          id?: string
          kirvano_order_id?: string
          name?: string | null
          phone?: string | null
          plan?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kirvano_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_queue: {
        Row: {
          attempts: number
          content: string
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          message_type: string
          next_attempt_at: string
          phone: string
          sent_at: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          content: string
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          message_type?: string
          next_attempt_at?: string
          phone: string
          sent_at?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          content?: string
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          message_type?: string
          next_attempt_at?: string
          phone?: string
          sent_at?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          intent: string | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          intent?: string | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          intent?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          created_at: string
          id: string
          source: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          source?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          source?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_whatsapp_links: {
        Row: {
          created_at: string
          expires_at: string
          phone_number: string
          push_name_hint: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          phone_number: string
          push_name_hint?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          phone_number?: string
          push_name_hint?: string | null
          user_id?: string
        }
        Relationships: []
      }
      processed_messages: {
        Row: {
          created_at: string
          message_id: string
        }
        Insert: {
          created_at?: string
          message_id: string
        }
        Update: {
          created_at?: string
          message_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          access_source: string | null
          access_until: string | null
          account_status: string
          created_at: string
          display_name: string | null
          id: string
          is_admin: boolean
          kirvano_subscription_id: string | null
          last_inactivity_alert_at: string | null
          link_code: string | null
          link_code_expires_at: string | null
          messages_limit: number
          messages_used: number
          phone_changes_count: number
          phone_number: string | null
          plan: string
          subscription_cancelled_at: string | null
          timezone: string
          updated_at: string
          whatsapp_lid: string | null
        }
        Insert: {
          access_source?: string | null
          access_until?: string | null
          account_status?: string
          created_at?: string
          display_name?: string | null
          id: string
          is_admin?: boolean
          kirvano_subscription_id?: string | null
          last_inactivity_alert_at?: string | null
          link_code?: string | null
          link_code_expires_at?: string | null
          messages_limit?: number
          messages_used?: number
          phone_changes_count?: number
          phone_number?: string | null
          plan?: string
          subscription_cancelled_at?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_lid?: string | null
        }
        Update: {
          access_source?: string | null
          access_until?: string | null
          account_status?: string
          created_at?: string
          display_name?: string | null
          id?: string
          is_admin?: boolean
          kirvano_subscription_id?: string | null
          last_inactivity_alert_at?: string | null
          link_code?: string | null
          link_code_expires_at?: string | null
          messages_limit?: number
          messages_used?: number
          phone_changes_count?: number
          phone_number?: string | null
          plan?: string
          subscription_cancelled_at?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_lid?: string | null
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          created_at: string
          id: string
          reply_text: string
          trigger_text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reply_text: string
          trigger_text: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reply_text?: string
          trigger_text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          blocked_until: string | null
          count: number
          hour_count: number | null
          hour_window_start: string | null
          phone_number: string
          window_start: string
        }
        Insert: {
          blocked_until?: string | null
          count?: number
          hour_count?: number | null
          hour_window_start?: string | null
          phone_number: string
          window_start?: string
        }
        Update: {
          blocked_until?: string | null
          count?: number
          hour_count?: number | null
          hour_window_start?: string | null
          phone_number?: string
          window_start?: string
        }
        Relationships: []
      }
      recurring_transactions: {
        Row: {
          active: boolean
          amount: number
          category: string
          created_at: string
          day_of_month: number | null
          description: string
          frequency: string
          id: string
          last_processed: string | null
          next_date: string
          type: string
          user_id: string
        }
        Insert: {
          active?: boolean
          amount: number
          category?: string
          created_at?: string
          day_of_month?: number | null
          description: string
          frequency: string
          id?: string
          last_processed?: string | null
          next_date: string
          type: string
          user_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          category?: string
          created_at?: string
          day_of_month?: number | null
          description?: string
          frequency?: string
          id?: string
          last_processed?: string | null
          next_date?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          created_at: string
          event_id: string | null
          habit_id: string | null
          id: string
          message: string
          processing_at: string | null
          recurrence: string
          recurrence_value: number | null
          send_at: string
          sent_at: string | null
          source: string
          status: string
          title: string | null
          user_id: string
          whatsapp_number: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          habit_id?: string | null
          id?: string
          message: string
          processing_at?: string | null
          recurrence?: string
          recurrence_value?: number | null
          send_at: string
          sent_at?: string | null
          source?: string
          status?: string
          title?: string | null
          user_id: string
          whatsapp_number: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          habit_id?: string | null
          id?: string
          message?: string
          processing_at?: string | null
          recurrence?: string
          recurrence_value?: number | null
          send_at?: string
          sent_at?: string | null
          source?: string
          status?: string
          title?: string | null
          user_id?: string
          whatsapp_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health: {
        Row: {
          checked_at: string
          is_online: boolean
          service: string
          status_detail: string | null
        }
        Insert: {
          checked_at?: string
          is_online?: boolean
          service: string
          status_detail?: string | null
        }
        Update: {
          checked_at?: string
          is_online?: boolean
          service?: string
          status_detail?: string | null
        }
        Relationships: []
      }
      system_health_log: {
        Row: {
          checked_at: string
          id: string
          is_online: boolean
          service: string
          status_detail: string | null
        }
        Insert: {
          checked_at?: string
          id?: string
          is_online: boolean
          service: string
          status_detail?: string | null
        }
        Update: {
          checked_at?: string
          id?: string
          is_online?: boolean
          service?: string
          status_detail?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          id: string
          installment_group: string | null
          installment_number: number | null
          installment_total: number | null
          source: string
          transaction_date: string
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string
          created_at?: string
          description: string
          id?: string
          installment_group?: string | null
          installment_number?: number | null
          installment_total?: number | null
          source?: string
          transaction_date?: string
          type?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          id?: string
          installment_group?: string | null
          installment_number?: number | null
          installment_total?: number | null
          source?: string
          transaction_date?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_phone_numbers: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          label: string | null
          phone_number: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          phone_number: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          phone_number?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_phone_numbers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          created_at: string
          id: string
          last_activity: string
          last_processed_id: string | null
          pending_action: string | null
          pending_context: Json | null
          phone_number: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_activity?: string
          last_processed_id?: string | null
          pending_action?: string | null
          pending_context?: Json | null
          phone_number: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_activity?: string
          last_processed_id?: string | null
          pending_action?: string | null
          pending_context?: Json | null
          phone_number?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_pending_reminders: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          event_id: string | null
          habit_id: string | null
          id: string
          message: string
          processing_at: string | null
          recurrence: string
          recurrence_value: number | null
          send_at: string
          sent_at: string | null
          source: string
          status: string
          title: string | null
          user_id: string
          whatsapp_number: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reminders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_old_error_logs: { Args: never; Returns: undefined }
      expire_stale_accounts: { Args: never; Returns: undefined }
      get_admin_analytics: { Args: never; Returns: Json }
      get_inactivity_alert_candidates: {
        Args: { p_ago48h: string; p_ago7d: string; p_ago96h: string }
        Returns: {
          display_name: string
          id: string
          phone_number: string
        }[]
      }
      get_user_id_by_email: { Args: { user_email: string }; Returns: string }
      reset_missed_streaks: { Args: never; Returns: undefined }
      send_pending_reminders: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
