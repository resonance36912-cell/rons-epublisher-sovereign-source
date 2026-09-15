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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      addon_credits: {
        Row: {
          created_at: string
          credit_type: string
          credits_total: number
          credits_used: number
          expires_at: string | null
          id: string
          price_id: string | null
          source: string
          stripe_session_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          credit_type: string
          credits_total: number
          credits_used?: number
          expires_at?: string | null
          id?: string
          price_id?: string | null
          source?: string
          stripe_session_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          credit_type?: string
          credits_total?: number
          credits_used?: number
          expires_at?: string | null
          id?: string
          price_id?: string | null
          source?: string
          stripe_session_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          event: string
          id: string
          page: string | null
          properties: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          page?: string | null
          properties?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          page?: string | null
          properties?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      api_usage_logs: {
        Row: {
          cost_estimate: number | null
          created_at: string
          duration_ms: number | null
          id: string
          metadata: Json | null
          service: string
          tokens_or_chars: number | null
          user_id: string | null
        }
        Insert: {
          cost_estimate?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          metadata?: Json | null
          service: string
          tokens_or_chars?: number | null
          user_id?: string | null
        }
        Update: {
          cost_estimate?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          metadata?: Json | null
          service?: string
          tokens_or_chars?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      app_settings_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: string
          key: string
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          key: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          key?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: []
      }
      beta_signups: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          granted_tier: string | null
          id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          coupon_id: string
          granted_tier?: string | null
          id?: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          coupon_id?: string
          granted_tier?: string | null
          id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          coupon_type: string
          created_at: string
          discount_value: number
          expires_at: string | null
          id: string
          max_redemptions: number
          target_tier: string
        }
        Insert: {
          active?: boolean
          code: string
          coupon_type?: string
          created_at?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          max_redemptions?: number
          target_tier?: string
        }
        Update: {
          active?: boolean
          code?: string
          coupon_type?: string
          created_at?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          max_redemptions?: number
          target_tier?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          created_at: string
          credits_granted: number
          credits_used: number
          id: string
          metadata: Json
          period_end: string
          period_start: string
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_granted?: number
          credits_used?: number
          id?: string
          metadata?: Json
          period_end?: string
          period_start?: string
          source?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_granted?: number
          credits_used?: number
          id?: string
          metadata?: Json
          period_end?: string
          period_start?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_packs: {
        Row: {
          active: boolean
          created_at: string
          highlight: boolean
          id: string
          image_credits: number
          name: string
          price_zar: number
          sort_order: number
          tagline: string
          tts_credits: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          highlight?: boolean
          id: string
          image_credits?: number
          name: string
          price_zar: number
          sort_order?: number
          tagline?: string
          tts_credits?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          highlight?: boolean
          id?: string
          image_credits?: number
          name?: string
          price_zar?: number
          sort_order?: number
          tagline?: string
          tts_credits?: number
          updated_at?: string
        }
        Relationships: []
      }
      credit_packs_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_fields: string[]
          id: string
          new_value: Json | null
          old_value: Json | null
          pack_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[]
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          pack_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[]
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          pack_id?: string
        }
        Relationships: []
      }
      hub_catalog_probe_runs: {
        Row: {
          all_match: boolean
          diff: Json
          error: string | null
          http_status: number | null
          id: string
          latency_ms: number | null
          ok: boolean
          ran_at: string
          ran_by: string | null
          raw: Json
        }
        Insert: {
          all_match?: boolean
          diff?: Json
          error?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          ok?: boolean
          ran_at?: string
          ran_by?: string | null
          raw?: Json
        }
        Update: {
          all_match?: boolean
          diff?: Json
          error?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          ok?: boolean
          ran_at?: string
          ran_by?: string | null
          raw?: Json
        }
        Relationships: []
      }
      payfast_checkout_sessions: {
        Row: {
          consumed_at: string | null
          coupon_code: string | null
          created_at: string
          expected_amount: number
          expires_at: string
          id: string
          price_id: string
          token: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          coupon_code?: string | null
          created_at?: string
          expected_amount: number
          expires_at?: string
          id?: string
          price_id: string
          token: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          coupon_code?: string | null
          created_at?: string
          expected_amount?: number
          expires_at?: string
          id?: string
          price_id?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      payg_entitlements: {
        Row: {
          consumed_at: string | null
          created_at: string
          id: string
          metadata: Json
          payfast_session_id: string
          sku: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          payfast_session_id: string
          sku: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          payfast_session_id?: string
          sku?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          amount_total: number
          created_at: string | null
          currency: string
          environment: string
          id: string
          price_id: string
          product_id: string
          stripe_customer_id: string
          stripe_session_id: string
          user_id: string
        }
        Insert: {
          amount_total?: number
          created_at?: string | null
          currency?: string
          environment?: string
          id?: string
          price_id: string
          product_id: string
          stripe_customer_id: string
          stripe_session_id: string
          user_id: string
        }
        Update: {
          amount_total?: number
          created_at?: string | null
          currency?: string
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          stripe_customer_id?: string
          stripe_session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      research_jobs: {
        Row: {
          config: Json | null
          created_at: string
          error: string | null
          id: string
          progress: number
          status: string
          status_message: string | null
          topic: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string
          error?: string | null
          id?: string
          progress?: number
          status?: string
          status_message?: string | null
          topic: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string
          error?: string | null
          id?: string
          progress?: number
          status?: string
          status_message?: string | null
          topic?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      research_outputs: {
        Row: {
          content: string
          created_at: string
          id: string
          job_id: string
          key_takeaways: Json | null
          output_type: string
          sections: Json | null
          source_citations: Json | null
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          job_id: string
          key_takeaways?: Json | null
          output_type?: string
          sections?: Json | null
          source_citations?: Json | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          job_id?: string
          key_takeaways?: Json | null
          output_type?: string
          sections?: Json | null
          source_citations?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "research_outputs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "research_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_sources: {
        Row: {
          cleaned_content: string | null
          created_at: string
          description: string | null
          error: string | null
          id: string
          job_id: string
          raw_content: string | null
          relevance_score: number | null
          source_type: string
          status: string
          title: string
          url: string | null
        }
        Insert: {
          cleaned_content?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          job_id: string
          raw_content?: string | null
          relevance_score?: number | null
          source_type?: string
          status?: string
          title: string
          url?: string | null
        }
        Update: {
          cleaned_content?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          job_id?: string
          raw_content?: string | null
          relevance_score?: number | null
          source_type?: string
          status?: string
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_sources_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "research_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      security_findings: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          metadata: Json
          remediation: string
          scan_id: string
          severity: string
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string
          id?: string
          metadata?: Json
          remediation?: string
          scan_id: string
          severity: string
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          metadata?: Json
          remediation?: string
          scan_id?: string
          severity?: string
          title?: string
        }
        Relationships: []
      }
      security_scans: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          started_at: string
          status: string
          totals: Json
          triggered_by: string | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          totals?: Json
          triggered_by?: string | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          totals?: Json
          triggered_by?: string | null
        }
        Relationships: []
      }
      service_budgets: {
        Row: {
          auto_eco_threshold: number
          created_at: string
          id: string
          monthly_budget: number
          service: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_eco_threshold?: number
          created_at?: string
          id?: string
          monthly_budget: number
          service: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_eco_threshold?: number
          created_at?: string
          id?: string
          monthly_budget?: number
          service?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      service_provider_config: {
        Row: {
          created_at: string
          id: string
          primary_provider: string
          service: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          primary_provider: string
          service: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          primary_provider?: string
          service?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      source_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          id: string
          job_id: string
          metadata: Json | null
          source_id: string
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          id?: string
          job_id: string
          metadata?: Json | null
          source_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          id?: string
          job_id?: string
          metadata?: Json | null
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_chunks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "research_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "research_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_access_logs: {
        Row: {
          action: string
          actor_role: string
          bucket: string
          created_at: string
          file_count: number
          id: string
          metadata: Json
          scope_path: string
          user_id: string
        }
        Insert: {
          action?: string
          actor_role: string
          bucket: string
          created_at?: string
          file_count?: number
          id?: string
          metadata?: Json
          scope_path?: string
          user_id: string
        }
        Update: {
          action?: string
          actor_role?: string
          bucket?: string
          created_at?: string
          file_count?: number
          id?: string
          metadata?: Json
          scope_path?: string
          user_id?: string
        }
        Relationships: []
      }
      storybook_projects: {
        Row: {
          archived_at: string | null
          chapters: Json
          config: Json
          created_at: string
          id: string
          last_accessed_at: string
          overall_rating: number
          sources: Json
          step: number
          storyline: string
          storyline_accepted: boolean
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          chapters?: Json
          config?: Json
          created_at?: string
          id?: string
          last_accessed_at?: string
          overall_rating?: number
          sources?: Json
          step?: number
          storyline?: string
          storyline_accepted?: boolean
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          chapters?: Json
          config?: Json
          created_at?: string
          id?: string
          last_accessed_at?: string
          overall_rating?: number
          sources?: Json
          step?: number
          storyline?: string
          storyline_accepted?: boolean
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stt_diagnostic_runs: {
        Row: {
          created_at: string
          engine: string
          error: string | null
          id: string
          latency_ms: number | null
          model_size: string | null
          reference_text: string | null
          success: boolean
          transcript: string | null
          user_id: string
          wer: number | null
        }
        Insert: {
          created_at?: string
          engine: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          model_size?: string | null
          reference_text?: string | null
          success?: boolean
          transcript?: string | null
          user_id: string
          wer?: number | null
        }
        Update: {
          created_at?: string
          engine?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          model_size?: string | null
          reference_text?: string | null
          success?: boolean
          transcript?: string | null
          user_id?: string
          wer?: number | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id: string
          product_id: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      support_access_grants: {
        Row: {
          admin_user_id: string | null
          expires_at: string
          granted_at: string
          id: string
          reason: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          admin_user_id?: string | null
          expires_at: string
          granted_at?: string
          id?: string
          reason?: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          admin_user_id?: string | null
          expires_at?: string
          granted_at?: string
          id?: string
          reason?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tier_quota_presets: {
        Row: {
          created_at: string
          daily_limit: number
          id: string
          quota_period: string
          service: string
          tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_limit: number
          id?: string
          quota_period?: string
          service: string
          tier: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_limit?: number
          id?: string
          quota_period?: string
          service?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      usage_limits: {
        Row: {
          created_at: string
          daily_limit: number
          id: string
          service: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_limit: number
          id?: string
          service: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_limit?: number
          id?: string
          service?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          amount_kobo: number | null
          created_at: string
          currency: string | null
          error_message: string | null
          event_type: string | null
          http_status: number
          id: string
          outcome: string
          payload: Json | null
          provider: string
          reference: string | null
          response_body: string | null
          signature_valid: boolean | null
          source_ip: string | null
          user_id: string | null
        }
        Insert: {
          amount_kobo?: number | null
          created_at?: string
          currency?: string | null
          error_message?: string | null
          event_type?: string | null
          http_status: number
          id?: string
          outcome: string
          payload?: Json | null
          provider: string
          reference?: string | null
          response_body?: string | null
          signature_valid?: boolean | null
          source_ip?: string | null
          user_id?: string | null
        }
        Update: {
          amount_kobo?: number | null
          created_at?: string
          currency?: string | null
          error_message?: string | null
          event_type?: string | null
          http_status?: number
          id?: string
          outcome?: string
          payload?: Json | null
          provider?: string
          reference?: string | null
          response_body?: string | null
          signature_valid?: boolean | null
          source_ip?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_user_quota: {
        Args: { _service: string; _user_id: string }
        Returns: Json
      }
      consume_addon_credits: {
        Args: { _amount: number; _credit_type: string; _user_id: string }
        Returns: number
      }
      consume_credits: {
        Args: { _amount: number; _reason?: string; _user_id: string }
        Returns: number
      }
      delete_account_data: { Args: { _user_id: string }; Returns: undefined }
      gc_inactive_free_projects: { Args: never; Returns: Json }
      get_addon_credits_remaining: {
        Args: { _credit_type: string; _user_id: string }
        Returns: number
      }
      get_credits_remaining: { Args: { _user_id: string }; Returns: number }
      get_daily_usage: {
        Args: { _service: string; _user_id: string }
        Returns: number
      }
      get_usage_limit: {
        Args: { _default: number; _service: string }
        Returns: number
      }
      get_user_daily_limit: {
        Args: { _service: string; _user_id: string }
        Returns: number
      }
      grant_lifetime_bundle: {
        Args: { _sku: string; _user_id: string }
        Returns: string
      }
      grant_monthly_credits: {
        Args: {
          _amount: number
          _metadata?: Json
          _period_days?: number
          _source?: string
          _user_id: string
        }
        Returns: string
      }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      has_active_support_grant: {
        Args: { _admin_id: string; _target_user_id: string }
        Returns: boolean
      }
      has_purchased: {
        Args: {
          check_env?: string
          check_product_id: string
          user_uuid: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      owns_research_job: {
        Args: { _job_id: string; _user_id: string }
        Returns: boolean
      }
      redeem_coupon: {
        Args: { _code: string; _user_id: string }
        Returns: Json
      }
      resolve_user_tier: { Args: { _user_id: string }; Returns: string }
      validate_coupon: {
        Args: { _code: string; _user_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
