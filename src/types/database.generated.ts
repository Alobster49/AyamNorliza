export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_review_items: {
        Row: {
          access_review_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string
          decision_reason: string | null
          evidence: Json
          id: string
          organization_member_id: string
        }
        Insert: {
          access_review_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          decision_reason?: string | null
          evidence?: Json
          id?: string
          organization_member_id: string
        }
        Update: {
          access_review_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          decision_reason?: string | null
          evidence?: Json
          id?: string
          organization_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_review_items_access_review_id_fkey"
            columns: ["access_review_id"]
            isOneToOne: false
            referencedRelation: "access_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_review_items_organization_member_id_fkey"
            columns: ["organization_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      access_reviews: {
        Row: {
          created_at: string
          due_at: string
          id: string
          organization_id: string
          period_end: string
          period_start: string
          reviewer_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          due_at: string
          id?: string
          organization_id: string
          period_end: string
          period_start: string
          reviewer_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          due_at?: string
          id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          reviewer_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "access_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          actor_role: string | null
          actor_session_id: string | null
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          client_operation_id: string | null
          correlation_id: string | null
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          occurred_at: string
          organization_id: string | null
          reason: string | null
          source: string
        }
        Insert: {
          actor_role?: string | null
          actor_session_id?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          client_operation_id?: string | null
          correlation_id?: string | null
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          occurred_at?: string
          organization_id?: string | null
          reason?: string | null
          source: string
        }
        Update: {
          actor_role?: string | null
          actor_session_id?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          client_operation_id?: string | null
          correlation_id?: string | null
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          occurred_at?: string
          organization_id?: string | null
          reason?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_security_events: {
        Row: {
          event_type: string
          geo_country: string | null
          id: string
          ip: unknown
          metadata: Json
          occurred_at: string
          organization_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          event_type: string
          geo_country?: string | null
          id?: string
          ip?: unknown
          metadata?: Json
          occurred_at?: string
          organization_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          event_type?: string
          geo_country?: string | null
          id?: string
          ip?: unknown
          metadata?: Json
          occurred_at?: string
          organization_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auth_security_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      biosecurity_zones: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          entry_rules: Json
          id: string
          name: string
          organization_id: string
          parent_zone_id: string | null
          risk_class: string
          site_id: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          entry_rules?: Json
          id?: string
          name: string
          organization_id: string
          parent_zone_id?: string | null
          risk_class?: string
          site_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          entry_rules?: Json
          id?: string
          name?: string
          organization_id?: string
          parent_zone_id?: string | null
          risk_class?: string
          site_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "biosecurity_zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "biosecurity_zones_parent_zone_id_fkey"
            columns: ["parent_zone_id"]
            isOneToOne: false
            referencedRelation: "biosecurity_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "biosecurity_zones_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      break_glass_events: {
        Row: {
          approved_by: string | null
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          organization_id: string
          post_use_review: Json
          reason: string
          starts_at: string
          ticket_reference: string | null
          user_id: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          organization_id: string
          post_use_review?: Json
          reason: string
          starts_at?: string
          ticket_reference?: string | null
          user_id: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          post_use_review?: Json
          reason?: string
          starts_at?: string
          ticket_reference?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "break_glass_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      code_sets: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          key: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          key: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          key?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "code_sets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      code_values: {
        Row: {
          code: string
          code_set_id: string
          created_at: string
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          label: string
          metadata: Json
          organization_id: string
          sort_order: number
          status: string
          translations: Json
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          code: string
          code_set_id: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          label: string
          metadata?: Json
          organization_id: string
          sort_order?: number
          status?: string
          translations?: Json
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          code?: string
          code_set_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          label?: string
          metadata?: Json
          organization_id?: string
          sort_order?: number
          status?: string
          translations?: Json
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "code_values_code_set_id_fkey"
            columns: ["code_set_id"]
            isOneToOne: false
            referencedRelation: "code_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_values_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flock_closeouts: {
        Row: {
          approval_notes: string
          approved_at: string
          approved_by: string
          created_at: string
          final_kpis: Json
          final_live_birds: number
          flock_id: string
          house_id: string | null
          id: string
          locked_at: string
          open_exceptions: Json
          organization_id: string
          reconciliation: Json
          site_id: string
        }
        Insert: {
          approval_notes: string
          approved_at?: string
          approved_by: string
          created_at?: string
          final_kpis?: Json
          final_live_birds: number
          flock_id: string
          house_id?: string | null
          id?: string
          locked_at?: string
          open_exceptions?: Json
          organization_id: string
          reconciliation?: Json
          site_id: string
        }
        Update: {
          approval_notes?: string
          approved_at?: string
          approved_by?: string
          created_at?: string
          final_kpis?: Json
          final_live_birds?: number
          flock_id?: string
          house_id?: string | null
          id?: string
          locked_at?: string
          open_exceptions?: Json
          organization_id?: string
          reconciliation?: Json
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flock_closeouts_flock_id_fkey"
            columns: ["flock_id"]
            isOneToOne: true
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_closeouts_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_closeouts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_closeouts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      flock_count_transactions: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          evidence: Json
          flock_id: string
          house_id: string | null
          id: string
          occurred_at: string
          organization_id: string
          quantity: number
          reason: string | null
          site_id: string
          source_id: string | null
          source_table: string | null
          transaction_type: string
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          evidence?: Json
          flock_id: string
          house_id?: string | null
          id?: string
          occurred_at?: string
          organization_id: string
          quantity: number
          reason?: string | null
          site_id: string
          source_id?: string | null
          source_table?: string | null
          transaction_type: string
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          evidence?: Json
          flock_id?: string
          house_id?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          quantity?: number
          reason?: string | null
          site_id?: string
          source_id?: string | null
          source_table?: string | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "flock_count_transactions_flock_id_fkey"
            columns: ["flock_id"]
            isOneToOne: false
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_count_transactions_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_count_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_count_transactions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      flock_movements: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          destination_flock_id: string | null
          destination_house_id: string | null
          id: string
          lineage: Json
          movement_type: string
          organization_id: string
          quantity: number
          reason: string
          site_id: string
          source_flock_id: string
          source_house_id: string | null
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          destination_flock_id?: string | null
          destination_house_id?: string | null
          id?: string
          lineage?: Json
          movement_type: string
          organization_id: string
          quantity: number
          reason: string
          site_id: string
          source_flock_id: string
          source_house_id?: string | null
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          destination_flock_id?: string | null
          destination_house_id?: string | null
          id?: string
          lineage?: Json
          movement_type?: string
          organization_id?: string
          quantity?: number
          reason?: string
          site_id?: string
          source_flock_id?: string
          source_house_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flock_movements_destination_flock_id_fkey"
            columns: ["destination_flock_id"]
            isOneToOne: false
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_movements_destination_house_id_fkey"
            columns: ["destination_house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_movements_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_movements_source_flock_id_fkey"
            columns: ["source_flock_id"]
            isOneToOne: false
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_movements_source_house_id_fkey"
            columns: ["source_house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
        ]
      }
      flock_plans: {
        Row: {
          approval_notes: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          flock_id: string
          health_plan: Json
          house_id: string | null
          id: string
          organization_id: string
          plan_notes: string | null
          required_documents: Json
          site_id: string
          supply_plan: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          flock_id: string
          health_plan?: Json
          house_id?: string | null
          id?: string
          organization_id: string
          plan_notes?: string | null
          required_documents?: Json
          site_id: string
          supply_plan?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          flock_id?: string
          health_plan?: Json
          house_id?: string | null
          id?: string
          organization_id?: string
          plan_notes?: string | null
          required_documents?: Json
          site_id?: string
          supply_plan?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flock_plans_flock_id_fkey"
            columns: ["flock_id"]
            isOneToOne: true
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_plans_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_plans_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      flock_stage_history: {
        Row: {
          age_day: number
          created_at: string
          effective_from: string
          effective_to: string | null
          flock_id: string
          house_id: string | null
          id: string
          organization_id: string
          override_reason: string | null
          site_id: string
          stage: string
          target_profile_version_id: string | null
        }
        Insert: {
          age_day: number
          created_at?: string
          effective_from: string
          effective_to?: string | null
          flock_id: string
          house_id?: string | null
          id?: string
          organization_id: string
          override_reason?: string | null
          site_id: string
          stage: string
          target_profile_version_id?: string | null
        }
        Update: {
          age_day?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          flock_id?: string
          house_id?: string | null
          id?: string
          organization_id?: string
          override_reason?: string | null
          site_id?: string
          stage?: string
          target_profile_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flock_stage_history_flock_id_fkey"
            columns: ["flock_id"]
            isOneToOne: false
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_stage_history_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_stage_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_stage_history_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flock_stage_history_target_profile_version_id_fkey"
            columns: ["target_profile_version_id"]
            isOneToOne: false
            referencedRelation: "target_profile_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      flocks: {
        Row: {
          breed_strain: string
          client_operation_id: string | null
          closed_at: string | null
          closed_by: string | null
          code: string
          created_at: string
          created_by: string | null
          current_live_birds: number
          expected_end_date: string | null
          hatch_date: string
          house_id: string | null
          id: string
          name: string
          organization_id: string
          planned_arrival_date: string
          planned_quantity: number
          production_profile_id: string
          production_type: string
          restriction_reason: string | null
          sex: string
          site_id: string
          source_name: string
          status: string
          target_profile_version_id: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          breed_strain: string
          client_operation_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          current_live_birds?: number
          expected_end_date?: string | null
          hatch_date: string
          house_id?: string | null
          id?: string
          name: string
          organization_id: string
          planned_arrival_date: string
          planned_quantity: number
          production_profile_id: string
          production_type: string
          restriction_reason?: string | null
          sex?: string
          site_id: string
          source_name: string
          status?: string
          target_profile_version_id?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          breed_strain?: string
          client_operation_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          current_live_birds?: number
          expected_end_date?: string | null
          hatch_date?: string
          house_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          planned_arrival_date?: string
          planned_quantity?: number
          production_profile_id?: string
          production_type?: string
          restriction_reason?: string | null
          sex?: string
          site_id?: string
          source_name?: string
          status?: string
          target_profile_version_id?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "flocks_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flocks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flocks_production_profile_id_fkey"
            columns: ["production_profile_id"]
            isOneToOne: false
            referencedRelation: "production_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flocks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flocks_target_profile_version_id_fkey"
            columns: ["target_profile_version_id"]
            isOneToOne: false
            referencedRelation: "target_profile_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      handovers: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledgement_notes: string | null
          created_at: string
          created_by: string | null
          equipment_state: Json
          from_shift_id: string
          id: string
          next_actions: Json
          organization_id: string
          restrictions: Json
          site_id: string
          to_shift_id: string
          unresolved_items: Json
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_notes?: string | null
          created_at?: string
          created_by?: string | null
          equipment_state?: Json
          from_shift_id: string
          id?: string
          next_actions?: Json
          organization_id: string
          restrictions?: Json
          site_id: string
          to_shift_id: string
          unresolved_items?: Json
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledgement_notes?: string | null
          created_at?: string
          created_by?: string | null
          equipment_state?: Json
          from_shift_id?: string
          id?: string
          next_actions?: Json
          organization_id?: string
          restrictions?: Json
          site_id?: string
          to_shift_id?: string
          unresolved_items?: Json
        }
        Relationships: [
          {
            foreignKeyName: "handovers_from_shift_id_fkey"
            columns: ["from_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_to_shift_id_fkey"
            columns: ["to_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      harvest_plans: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          crew_notes: string | null
          destination: string
          expected_quantity: number
          expected_weight_kg: number | null
          flock_id: string
          house_id: string | null
          id: string
          organization_id: string
          planned_date: string
          readiness: Json
          site_id: string
          updated_at: string
          updated_by: string | null
          vehicle_reference: string | null
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          crew_notes?: string | null
          destination: string
          expected_quantity: number
          expected_weight_kg?: number | null
          flock_id: string
          house_id?: string | null
          id?: string
          organization_id: string
          planned_date: string
          readiness?: Json
          site_id: string
          updated_at?: string
          updated_by?: string | null
          vehicle_reference?: string | null
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          crew_notes?: string | null
          destination?: string
          expected_quantity?: number
          expected_weight_kg?: number | null
          flock_id?: string
          house_id?: string | null
          id?: string
          organization_id?: string
          planned_date?: string
          readiness?: Json
          site_id?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "harvest_plans_flock_id_fkey"
            columns: ["flock_id"]
            isOneToOne: false
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harvest_plans_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harvest_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harvest_plans_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      house_areas: {
        Row: {
          area_type: string
          capacity_birds: number | null
          code: string
          created_at: string
          created_by: string | null
          geometry: Json
          house_id: string
          id: string
          name: string
          organization_id: string
          sequence: number
          site_id: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          area_type?: string
          capacity_birds?: number | null
          code: string
          created_at?: string
          created_by?: string | null
          geometry?: Json
          house_id: string
          id?: string
          name: string
          organization_id: string
          sequence?: number
          site_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          area_type?: string
          capacity_birds?: number | null
          code?: string
          created_at?: string
          created_by?: string | null
          geometry?: Json
          house_id?: string
          id?: string
          name?: string
          organization_id?: string
          sequence?: number
          site_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "house_areas_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "house_areas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "house_areas_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      house_readiness_reviews: {
        Row: {
          approval_status: string
          approved_at: string
          approved_by: string
          approver_notes: string
          checklist_version: string
          created_at: string
          exceptions: Json
          flock_id: string
          house_id: string
          id: string
          organization_id: string
          results: Json
          site_id: string
        }
        Insert: {
          approval_status?: string
          approved_at?: string
          approved_by: string
          approver_notes: string
          checklist_version: string
          created_at?: string
          exceptions?: Json
          flock_id: string
          house_id: string
          id?: string
          organization_id: string
          results?: Json
          site_id: string
        }
        Update: {
          approval_status?: string
          approved_at?: string
          approved_by?: string
          approver_notes?: string
          checklist_version?: string
          created_at?: string
          exceptions?: Json
          flock_id?: string
          house_id?: string
          id?: string
          organization_id?: string
          results?: Json
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "house_readiness_reviews_flock_id_fkey"
            columns: ["flock_id"]
            isOneToOne: false
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "house_readiness_reviews_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "house_readiness_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "house_readiness_reviews_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      houses: {
        Row: {
          capacity_birds: number
          client_operation_id: string | null
          code: string
          coordinates: Json
          created_at: string
          created_by: string | null
          criticality: string
          equipment: Json
          floor_plan: Json
          height_meters: number | null
          housing_system: string
          id: string
          length_meters: number | null
          name: string
          operational_status: string
          organization_id: string
          production_purpose: string
          site_id: string
          updated_at: string
          updated_by: string | null
          version: number
          width_meters: number | null
          zone_id: string | null
        }
        Insert: {
          capacity_birds?: number
          client_operation_id?: string | null
          code: string
          coordinates?: Json
          created_at?: string
          created_by?: string | null
          criticality?: string
          equipment?: Json
          floor_plan?: Json
          height_meters?: number | null
          housing_system: string
          id?: string
          length_meters?: number | null
          name: string
          operational_status?: string
          organization_id: string
          production_purpose: string
          site_id: string
          updated_at?: string
          updated_by?: string | null
          version?: number
          width_meters?: number | null
          zone_id?: string | null
        }
        Update: {
          capacity_birds?: number
          client_operation_id?: string | null
          code?: string
          coordinates?: Json
          created_at?: string
          created_by?: string | null
          criticality?: string
          equipment?: Json
          floor_plan?: Json
          height_meters?: number | null
          housing_system?: string
          id?: string
          length_meters?: number | null
          name?: string
          operational_status?: string
          organization_id?: string
          production_purpose?: string
          site_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
          width_meters?: number | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "houses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "houses_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "houses_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "biosecurity_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_responses: {
        Row: {
          created_at: string
          created_by: string | null
          exception_reason: string | null
          id: string
          inspection_id: string
          label: string | null
          organization_id: string
          question_key: string
          response_type: string
          source: string
          status: string
          unit: string | null
          value: Json
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          exception_reason?: string | null
          id?: string
          inspection_id: string
          label?: string | null
          organization_id: string
          question_key: string
          response_type: string
          source?: string
          status?: string
          unit?: string | null
          value: Json
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          exception_reason?: string | null
          id?: string
          inspection_id?: string
          label?: string | null
          organization_id?: string
          question_key?: string
          response_type?: string
          source?: string
          status?: string
          unit?: string | null
          value?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inspection_responses_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_template_versions: {
        Row: {
          applicability: Json
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          definition: Json
          effective_from: string | null
          effective_to: string | null
          id: string
          organization_id: string
          production_types: string[]
          risk_classes: string[]
          row_version: number
          status: string
          template_id: string
          updated_at: string
          updated_by: string | null
          version: string
        }
        Insert: {
          applicability?: Json
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          definition?: Json
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          organization_id: string
          production_types?: string[]
          risk_classes?: string[]
          row_version?: number
          status?: string
          template_id: string
          updated_at?: string
          updated_by?: string | null
          version: string
        }
        Update: {
          applicability?: Json
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          definition?: Json
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          organization_id?: string
          production_types?: string[]
          risk_classes?: string[]
          row_version?: number
          status?: string
          template_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_template_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inspection_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          client_operation_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          device_time: string | null
          entry_time: string
          event_time: string
          flock_id: string | null
          house_id: string
          id: string
          organization_id: string
          quality_score: number | null
          shift_id: string | null
          signature: string | null
          site_id: string
          started_at: string
          started_by: string | null
          status: string
          sync_status: string
          sync_time: string | null
          template_version_id: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          client_operation_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          device_time?: string | null
          entry_time?: string
          event_time?: string
          flock_id?: string | null
          house_id: string
          id?: string
          organization_id: string
          quality_score?: number | null
          shift_id?: string | null
          signature?: string | null
          site_id: string
          started_at?: string
          started_by?: string | null
          status?: string
          sync_status?: string
          sync_time?: string | null
          template_version_id: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          client_operation_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          device_time?: string | null
          entry_time?: string
          event_time?: string
          flock_id?: string | null
          house_id?: string
          id?: string
          organization_id?: string
          quality_score?: number | null
          shift_id?: string | null
          signature?: string | null
          site_id?: string
          started_at?: string
          started_by?: string | null
          status?: string
          sync_status?: string
          sync_time?: string | null
          template_version_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inspections_flock_id_fkey"
            columns: ["flock_id"]
            isOneToOne: false
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "inspection_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          client_operation_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          proposed_scopes: Json
          revoked_at: string | null
          role: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          client_operation_id?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          proposed_scopes?: Json
          revoked_at?: string | null
          role: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          client_operation_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          proposed_scopes?: Json
          revoked_at?: string | null
          role?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_scopes: {
        Row: {
          created_at: string
          expires_at: string | null
          house_id: string | null
          id: string
          organization_id: string
          organization_member_id: string
          permission: string | null
          site_id: string | null
          starts_at: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          house_id?: string | null
          id?: string
          organization_id: string
          organization_member_id: string
          permission?: string | null
          site_id?: string | null
          starts_at?: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          house_id?: string | null
          id?: string
          organization_id?: string
          organization_member_id?: string
          permission?: string | null
          site_id?: string | null
          starts_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_scopes_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_scopes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_scopes_organization_member_id_fkey"
            columns: ["organization_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_scopes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_scopes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "biosecurity_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      observations: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string
          flock_id: string | null
          follow_up: Json
          follow_up_type: string | null
          house_id: string
          id: string
          immediate_action: string | null
          inspection_id: string | null
          media: Json
          organization_id: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          site_id: string
          status: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          description: string
          flock_id?: string | null
          follow_up?: Json
          follow_up_type?: string | null
          house_id: string
          id?: string
          immediate_action?: string | null
          inspection_id?: string | null
          media?: Json
          organization_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          site_id: string
          status?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          flock_id?: string | null
          follow_up?: Json
          follow_up_type?: string | null
          house_id?: string
          id?: string
          immediate_action?: string | null
          inspection_id?: string | null
          media?: Json
          organization_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          site_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "observations_flock_id_fkey"
            columns: ["flock_id"]
            isOneToOne: false
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          client_operation_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          invited_by: string | null
          organization_id: string
          role: string
          sponsor_id: string | null
          starts_at: string
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          client_operation_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          organization_id: string
          role: string
          sponsor_id?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          client_operation_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: string
          sponsor_id?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          default_locale: string
          default_time_zone: string
          id: string
          legal_name: string | null
          name: string
          region: string | null
          slug: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_locale?: string
          default_time_zone?: string
          id?: string
          legal_name?: string | null
          name: string
          region?: string | null
          slug: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_locale?: string
          default_time_zone?: string
          id?: string
          legal_name?: string | null
          name?: string
          region?: string | null
          slug?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      period_closes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          completeness: Json
          created_at: string
          created_by: string | null
          house_id: string | null
          id: string
          locked_at: string | null
          operating_date: string | null
          organization_id: string
          period_end: string
          period_start: string
          period_type: string
          reviewed_by: string | null
          reviewer_notes: string | null
          site_id: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          completeness?: Json
          created_at?: string
          created_by?: string | null
          house_id?: string | null
          id?: string
          locked_at?: string | null
          operating_date?: string | null
          organization_id: string
          period_end: string
          period_start: string
          period_type: string
          reviewed_by?: string | null
          reviewer_notes?: string | null
          site_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          completeness?: Json
          created_at?: string
          created_by?: string | null
          house_id?: string | null
          id?: string
          locked_at?: string | null
          operating_date?: string | null
          organization_id?: string
          period_end?: string
          period_start?: string
          period_type?: string
          reviewed_by?: string | null
          reviewer_notes?: string | null
          site_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "period_closes_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "period_closes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "period_closes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      placements: {
        Row: {
          accepted_at: string
          accepted_by: string
          actual_quantity: number
          created_at: string
          doa_quantity: number
          flock_id: string
          house_id: string
          id: string
          initial_observations: string | null
          organization_id: string
          placement_time: string
          site_id: string
          supplier_reference: string | null
          vehicle_reference: string | null
        }
        Insert: {
          accepted_at?: string
          accepted_by: string
          actual_quantity: number
          created_at?: string
          doa_quantity?: number
          flock_id: string
          house_id: string
          id?: string
          initial_observations?: string | null
          organization_id: string
          placement_time: string
          site_id: string
          supplier_reference?: string | null
          vehicle_reference?: string | null
        }
        Update: {
          accepted_at?: string
          accepted_by?: string
          actual_quantity?: number
          created_at?: string
          doa_quantity?: number
          flock_id?: string
          house_id?: string
          id?: string
          initial_observations?: string | null
          organization_id?: string
          placement_time?: string
          site_id?: string
          supplier_reference?: string | null
          vehicle_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "placements_flock_id_fkey"
            columns: ["flock_id"]
            isOneToOne: false
            referencedRelation: "flocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      production_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          owner_user_id: string | null
          status: string
          type: string
          updated_at: string
          updated_by: string | null
          version: number
          workflow_options: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          owner_user_id?: string | null
          status?: string
          type: string
          updated_at?: string
          updated_by?: string | null
          version?: number
          workflow_options?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          owner_user_id?: string | null
          status?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
          workflow_options?: Json
        }
        Relationships: [
          {
            foreignKeyName: "production_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          contact_preferences: Json
          created_at: string
          display_name: string
          locale: string
          status: string
          time_zone: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          contact_preferences?: Json
          created_at?: string
          display_name: string
          locale?: string
          status?: string
          time_zone?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          contact_preferences?: Json
          created_at?: string
          display_name?: string
          locale?: string
          status?: string
          time_zone?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      qr_identifiers: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          generated_at: string
          generated_by: string | null
          id: string
          organization_id: string
          printable_code: string
          replaced_by: string | null
          replacement_reason: string | null
          retired_at: string | null
          status: string
          symbology: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          organization_id: string
          printable_code: string
          replaced_by?: string | null
          replacement_reason?: string | null
          retired_at?: string | null
          status?: string
          symbology?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          organization_id?: string
          printable_code?: string
          replaced_by?: string | null
          replacement_reason?: string | null
          retired_at?: string | null
          status?: string
          symbology?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_identifiers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_identifiers_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "qr_identifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      record_corrections: {
        Row: {
          after_value: Json
          before_value: Json
          decided_at: string | null
          decided_by: string | null
          id: string
          organization_id: string
          reason: string
          requested_at: string
          requested_by: string
          reviewer_reason: string | null
          risk_level: string
          status: string
          target_record_id: string
          target_table: string
        }
        Insert: {
          after_value?: Json
          before_value?: Json
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          organization_id: string
          reason: string
          requested_at?: string
          requested_by: string
          reviewer_reason?: string | null
          risk_level?: string
          status?: string
          target_record_id: string
          target_table: string
        }
        Update: {
          after_value?: Json
          before_value?: Json
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          organization_id?: string
          reason?: string
          requested_at?: string
          requested_by?: string
          reviewer_reason?: string | null
          risk_level?: string
          status?: string
          target_record_id?: string
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_corrections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_assignments: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          created_by: string | null
          house_id: string | null
          id: string
          organization_id: string
          responsibility: string
          shift_id: string
          site_id: string
          status: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          house_id?: string | null
          id?: string
          organization_id: string
          responsibility: string
          shift_id: string
          site_id: string
          status?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          house_id?: string | null
          id?: string
          organization_id?: string
          responsibility?: string
          shift_id?: string
          site_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          name: string
          organization_id: string
          role_requirements: Json
          site_id: string
          starts_at: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          name: string
          organization_id: string
          role_requirements?: Json
          site_id: string
          starts_at: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          name?: string
          organization_id?: string
          role_requirements?: Json
          site_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          biosecurity_layout: Json
          client_operation_id: string | null
          code: string
          contacts: Json
          created_at: string
          created_by: string | null
          currency_code: string
          default_unit_system: string
          id: string
          latitude: number | null
          legal_name: string | null
          longitude: number | null
          name: string
          organization_id: string
          status: string
          time_zone: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          address?: string | null
          biosecurity_layout?: Json
          client_operation_id?: string | null
          code: string
          contacts?: Json
          created_at?: string
          created_by?: string | null
          currency_code?: string
          default_unit_system?: string
          id?: string
          latitude?: number | null
          legal_name?: string | null
          longitude?: number | null
          name: string
          organization_id: string
          status?: string
          time_zone: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          address?: string | null
          biosecurity_layout?: Json
          client_operation_id?: string | null
          code?: string
          contacts?: Json
          created_at?: string
          created_by?: string | null
          currency_code?: string
          default_unit_system?: string
          id?: string
          latitude?: number | null
          legal_name?: string | null
          longitude?: number | null
          name?: string
          organization_id?: string
          status?: string
          time_zone?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_locations: {
        Row: {
          code: string
          conditions: Json
          created_at: string
          created_by: string | null
          id: string
          location_type: string
          name: string
          organization_id: string
          restricted: boolean
          site_id: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
          zone_id: string | null
        }
        Insert: {
          code: string
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          location_type: string
          name: string
          organization_id: string
          restricted?: boolean
          site_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
          zone_id?: string | null
        }
        Update: {
          code?: string
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          location_type?: string
          name?: string
          organization_id?: string
          restricted?: boolean
          site_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_locations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_locations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "biosecurity_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      support_sessions: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          organization_id: string
          permitted_scopes: Json
          purpose: string
          recording_reference: string | null
          sponsor_id: string
          starts_at: string
          status: string
          technician_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          organization_id: string
          permitted_scopes?: Json
          purpose: string
          recording_reference?: string | null
          sponsor_id: string
          starts_at: string
          status?: string
          technician_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          organization_id?: string
          permitted_scopes?: Json
          purpose?: string
          recording_reference?: string | null
          sponsor_id?: string
          starts_at?: string
          status?: string
          technician_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_operations: {
        Row: {
          attachment_references: Json
          base_server_version: number | null
          client_operation_id: string
          conflict_detail: Json
          created_at: string
          device_id: string | null
          entity_id: string
          entity_type: string
          id: string
          local_event_time: string
          local_save_time: string
          mutation_type: string
          organization_id: string
          payload: Json
          payload_schema_version: number
          processed_at: string | null
          result: string
          session_id: string | null
          upload_state: string
          user_id: string | null
        }
        Insert: {
          attachment_references?: Json
          base_server_version?: number | null
          client_operation_id: string
          conflict_detail?: Json
          created_at?: string
          device_id?: string | null
          entity_id: string
          entity_type: string
          id?: string
          local_event_time: string
          local_save_time: string
          mutation_type: string
          organization_id: string
          payload?: Json
          payload_schema_version: number
          processed_at?: string | null
          result?: string
          session_id?: string | null
          upload_state?: string
          user_id?: string | null
        }
        Update: {
          attachment_references?: Json
          base_server_version?: number | null
          client_operation_id?: string
          conflict_detail?: Json
          created_at?: string
          device_id?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          local_event_time?: string
          local_save_time?: string
          mutation_type?: string
          organization_id?: string
          payload?: Json
          payload_schema_version?: number
          processed_at?: string | null
          result?: string
          session_id?: string | null
          upload_state?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      target_curve_points: {
        Row: {
          age_end_day: number
          age_start_day: number
          created_at: string
          id: string
          interpolation_method: string
          max_value: number | null
          metric: string
          min_value: number | null
          organization_id: string
          stage: string | null
          target_profile_version_id: string
          target_value: number
          unit: string
        }
        Insert: {
          age_end_day: number
          age_start_day: number
          created_at?: string
          id?: string
          interpolation_method?: string
          max_value?: number | null
          metric: string
          min_value?: number | null
          organization_id: string
          stage?: string | null
          target_profile_version_id: string
          target_value: number
          unit: string
        }
        Update: {
          age_end_day?: number
          age_start_day?: number
          created_at?: string
          id?: string
          interpolation_method?: string
          max_value?: number | null
          metric?: string
          min_value?: number | null
          organization_id?: string
          stage?: string | null
          target_profile_version_id?: string
          target_value?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "target_curve_points_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "target_curve_points_target_profile_version_id_fkey"
            columns: ["target_profile_version_id"]
            isOneToOne: false
            referencedRelation: "target_profile_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      target_profile_versions: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          definition: Json
          definition_hash: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          organization_id: string
          row_version: number
          source_document: string | null
          status: string
          target_profile_id: string
          updated_at: string
          updated_by: string | null
          version: string
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          definition?: Json
          definition_hash?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          organization_id: string
          row_version?: number
          source_document?: string | null
          status?: string
          target_profile_id: string
          updated_at?: string
          updated_by?: string | null
          version: string
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          definition?: Json
          definition_hash?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          organization_id?: string
          row_version?: number
          source_document?: string | null
          status?: string
          target_profile_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "target_profile_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "target_profile_versions_target_profile_id_fkey"
            columns: ["target_profile_id"]
            isOneToOne: false
            referencedRelation: "target_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      target_profiles: {
        Row: {
          breed_strain: string
          created_at: string
          created_by: string | null
          housing_system: string | null
          id: string
          organization_id: string
          owner_user_id: string | null
          production_type: string
          profile_family: string
          region: string | null
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          breed_strain: string
          created_at?: string
          created_by?: string | null
          housing_system?: string | null
          id?: string
          organization_id: string
          owner_user_id?: string | null
          production_type: string
          profile_family: string
          region?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          breed_strain?: string
          created_at?: string
          created_by?: string | null
          housing_system?: string | null
          id?: string
          organization_id?: string
          owner_user_id?: string | null
          production_type?: string
          profile_family?: string
          region?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "target_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_structure_scope: {
        Args: {
          target_house?: string
          target_org: string
          target_site?: string
          target_zone?: string
        }
        Returns: boolean
      }
      current_actor_session_id: { Args: never; Returns: string }
      has_org_role: {
        Args: { roles: string[]; target_org: string }
        Returns: boolean
      }
      is_active_org_member: { Args: { target_org: string }; Returns: boolean }
      is_break_glass_active: { Args: { target_org: string }; Returns: boolean }
      is_daily_record_locked: {
        Args: { target_record_id: string; target_table: string }
        Returns: boolean
      }
      is_valid_flock_status_transition: {
        Args: { new_status: string; old_status: string }
        Returns: boolean
      }
      record_audit_event: {
        Args: {
          p_after: Json
          p_before: Json
          p_client_operation_id: string
          p_correlation_id: string
          p_entity_id: string
          p_entity_type: string
          p_event_type: string
          p_reason: string
        }
        Returns: string
      }
      record_auth_security_event: {
        Args: {
          p_event_type: string
          p_geo_country: string
          p_ip: unknown
          p_metadata: Json
          p_organization_id: string
          p_user_agent: string
          p_user_id: string
        }
        Returns: string
      }
      role_rank: { Args: { role: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

