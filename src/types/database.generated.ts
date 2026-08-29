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
      bays: {
        Row: {
          created_at: string
          created_by: string | null
          facility_id: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          position: number
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          position?: number
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          position?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bays_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      buyer_addresses: {
        Row: {
          address_line: string
          area: string
          buyer_id: string
          created_at: string
          id: string
          is_default: boolean
          postcode: string
          state: string
          updated_at: string
        }
        Insert: {
          address_line: string
          area: string
          buyer_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          postcode: string
          state: string
          updated_at?: string
        }
        Update: {
          address_line?: string
          area?: string
          buyer_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          postcode?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyer_addresses_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
        ]
      }
      buyers: {
        Row: {
          address: string | null
          created_at: string
          customer_id: string | null
          display_name: string
          id: string
          locale: string
          organization_id: string
          phone: string | null
          updated_at: string
          version: number
        }
        Insert: {
          address?: string | null
          created_at?: string
          customer_id?: string | null
          display_name: string
          id: string
          locale?: string
          organization_id: string
          phone?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          address?: string | null
          created_at?: string
          customer_id?: string | null
          display_name?: string
          id?: string
          locale?: string
          organization_id?: string
          phone?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "buyers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          area: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string
          phone_normalized: string | null
          postcode: string | null
          state: string | null
          updated_at: string
          version: number
        }
        Insert: {
          address?: string | null
          area?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone: string
          phone_normalized?: string | null
          postcode?: string | null
          state?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          address?: string | null
          area?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string
          phone_normalized?: string | null
          postcode?: string | null
          state?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_attempts: {
        Row: {
          attempted_at: string
          cash_collected: number | null
          created_at: string
          id: string
          next_action:
            | Database["public"]["Enums"]["delivery_next_action"]
            | null
          note: string | null
          order_id: string
          organization_id: string
          outcome: Database["public"]["Enums"]["delivery_outcome"]
          photo_path: string | null
          reason: Database["public"]["Enums"]["delivery_failure_reason"] | null
          received_by: string | null
          recorded_by: string
          run_id: string
          signature_path: string | null
        }
        Insert: {
          attempted_at?: string
          cash_collected?: number | null
          created_at?: string
          id?: string
          next_action?:
            | Database["public"]["Enums"]["delivery_next_action"]
            | null
          note?: string | null
          order_id: string
          organization_id: string
          outcome: Database["public"]["Enums"]["delivery_outcome"]
          photo_path?: string | null
          reason?: Database["public"]["Enums"]["delivery_failure_reason"] | null
          received_by?: string | null
          recorded_by: string
          run_id: string
          signature_path?: string | null
        }
        Update: {
          attempted_at?: string
          cash_collected?: number | null
          created_at?: string
          id?: string
          next_action?:
            | Database["public"]["Enums"]["delivery_next_action"]
            | null
          note?: string | null
          order_id?: string
          organization_id?: string
          outcome?: Database["public"]["Enums"]["delivery_outcome"]
          photo_path?: string | null
          reason?: Database["public"]["Enums"]["delivery_failure_reason"] | null
          received_by?: string | null
          recorded_by?: string
          run_id?: string
          signature_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_attempts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "delivery_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_runs: {
        Row: {
          created_at: string
          driver_id: string | null
          id: string
          notes: string | null
          organization_id: string
          run_date: string
          status: Database["public"]["Enums"]["delivery_run_status"]
          truck_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          driver_id?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          run_date: string
          status?: Database["public"]["Enums"]["delivery_run_status"]
          truck_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          driver_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          run_date?: string
          status?: Database["public"]["Enums"]["delivery_run_status"]
          truck_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_runs_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_slots: {
        Row: {
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          is_active: boolean
          max_orders: number | null
          organization_id: string
          start_time: string
          truck_id: string
          updated_at: string
          version: number
          weekday: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          is_active?: boolean
          max_orders?: number | null
          organization_id: string
          start_time: string
          truck_id: string
          updated_at?: string
          version?: number
          weekday: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          is_active?: boolean
          max_orders?: number | null
          organization_id?: string
          start_time?: string
          truck_id?: string
          updated_at?: string
          version?: number
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_slots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_slots_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_zones: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          address_line: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          postcode: string
          state: string
          updated_at: string
          version: number
        }
        Insert: {
          address_line: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          postcode: string
          state: string
          updated_at?: string
          version?: number
        }
        Update: {
          address_line?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          postcode?: string
          state?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "facilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      leave_credit_requests: {
        Row: {
          amount: number
          attachment_path: string | null
          created_at: string
          credit_type: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          justification: string | null
          leave_type_id: string
          organization_id: string
          reference_end: string
          reference_start: string
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          attachment_path?: string | null
          created_at?: string
          credit_type?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          justification?: string | null
          leave_type_id: string
          organization_id: string
          reference_end: string
          reference_start: string
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          attachment_path?: string | null
          created_at?: string
          credit_type?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          justification?: string | null
          leave_type_id?: string
          organization_id?: string
          reference_end?: string
          reference_start?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_credit_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_credit_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          days: number
          expires_on: string | null
          id: string
          kind: string
          leave_type_id: string
          note: string | null
          organization_id: string
          user_id: string
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days: number
          expires_on?: string | null
          id?: string
          kind: string
          leave_type_id: string
          note?: string | null
          organization_id: string
          user_id: string
          year: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days?: number
          expires_on?: string | null
          id?: string
          kind?: string
          leave_type_id?: string
          note?: string | null
          organization_id?: string
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_ledger_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          attachment_path: string | null
          breakdown: Json | null
          created_at: string
          day_count: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          end_date: string
          id: string
          justification: string
          leave_type_id: string
          organization_id: string
          start_date: string
          status: string
          user_id: string
          year: number
        }
        Insert: {
          attachment_path?: string | null
          breakdown?: Json | null
          created_at?: string
          day_count: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          end_date: string
          id?: string
          justification: string
          leave_type_id: string
          organization_id: string
          start_date: string
          status?: string
          user_id: string
          year: number
        }
        Update: {
          attachment_path?: string | null
          breakdown?: Json | null
          created_at?: string
          day_count?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          end_date?: string
          id?: string
          justification?: string
          leave_type_id?: string
          organization_id?: string
          start_date?: string
          status?: string
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          accrual: string
          carry_forward_cap: number | null
          code: string
          created_at: string
          entitlement_days: number | null
          id: string
          name: string
          organization_id: string
          requires_attachment: boolean
          sort: number
        }
        Insert: {
          accrual?: string
          carry_forward_cap?: number | null
          code: string
          created_at?: string
          entitlement_days?: number | null
          id?: string
          name: string
          organization_id: string
          requires_attachment?: boolean
          sort?: number
        }
        Update: {
          accrual?: string
          carry_forward_cap?: number | null
          code?: string
          created_at?: string
          entitlement_days?: number | null
          id?: string
          name?: string
          organization_id?: string
          requires_attachment?: boolean
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      market_premises: {
        Row: {
          district: string | null
          premise_code: number
          state: string
          synced_at: string
        }
        Insert: {
          district?: string | null
          premise_code: number
          state: string
          synced_at?: string
        }
        Update: {
          district?: string | null
          premise_code?: number
          state?: string
          synced_at?: string
        }
        Relationships: []
      }
      market_prices: {
        Row: {
          avg_price: number
          created_at: string
          item_code: number
          max_price: number
          median_price: number
          min_price: number
          premise_count: number
          price_date: string
          state: string
        }
        Insert: {
          avg_price: number
          created_at?: string
          item_code: number
          max_price: number
          median_price: number
          min_price: number
          premise_count: number
          price_date: string
          state: string
        }
        Update: {
          avg_price?: number
          created_at?: string
          item_code?: number
          max_price?: number
          median_price?: number
          min_price?: number
          premise_count?: number
          price_date?: string
          state?: string
        }
        Relationships: []
      }
      market_settings: {
        Row: {
          org_id: string
          states: string[]
          updated_at: string
        }
        Insert: {
          org_id: string
          states?: string[]
          updated_at?: string
        }
        Update: {
          org_id?: string
          states?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
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
        ]
      }
      order_items: {
        Row: {
          created_at: string
          fallback: Database["public"]["Enums"]["order_fallback"]
          fallback_applied: Database["public"]["Enums"]["order_fallback"] | null
          final_pieces: number | null
          final_weight_kg: number | null
          id: string
          is_cancelled: boolean
          line_total: number | null
          mode: Database["public"]["Enums"]["order_item_mode"]
          order_id: string
          price_per_kg: number | null
          product_id: string
          quantity: number
          size_max_kg: number
          size_min_kg: number
          updated_at: string
          version: number
          warehouse_pieces: number | null
          warehouse_weight_kg: number | null
        }
        Insert: {
          created_at?: string
          fallback: Database["public"]["Enums"]["order_fallback"]
          fallback_applied?:
            | Database["public"]["Enums"]["order_fallback"]
            | null
          final_pieces?: number | null
          final_weight_kg?: number | null
          id?: string
          is_cancelled?: boolean
          line_total?: number | null
          mode: Database["public"]["Enums"]["order_item_mode"]
          order_id: string
          price_per_kg?: number | null
          product_id: string
          quantity: number
          size_max_kg: number
          size_min_kg: number
          updated_at?: string
          version?: number
          warehouse_pieces?: number | null
          warehouse_weight_kg?: number | null
        }
        Update: {
          created_at?: string
          fallback?: Database["public"]["Enums"]["order_fallback"]
          fallback_applied?:
            | Database["public"]["Enums"]["order_fallback"]
            | null
          final_pieces?: number | null
          final_weight_kg?: number | null
          id?: string
          is_cancelled?: boolean
          line_total?: number | null
          mode?: Database["public"]["Enums"]["order_item_mode"]
          order_id?: string
          price_per_kg?: number | null
          product_id?: string
          quantity?: number
          size_max_kg?: number
          size_min_kg?: number
          updated_at?: string
          version?: number
          warehouse_pieces?: number | null
          warehouse_weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          done_at: string | null
          done_by: string | null
          id: string
          order_id: string
          organization_id: string
          status: Database["public"]["Enums"]["order_task_status"]
          type: string
          updated_at: string
          version: number
          weigh_claimed_at: string | null
          weigh_claimed_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          order_id: string
          organization_id: string
          status?: Database["public"]["Enums"]["order_task_status"]
          type?: string
          updated_at?: string
          version?: number
          weigh_claimed_at?: string | null
          weigh_claimed_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          order_id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["order_task_status"]
          type?: string
          updated_at?: string
          version?: number
          weigh_claimed_at?: string | null
          weigh_claimed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_weight_log: {
        Row: {
          id: string
          kind: Database["public"]["Enums"]["weight_log_kind"]
          order_item_id: string
          organization_id: string
          pieces: number | null
          recorded_at: string
          recorded_by: string
          weight_kg: number
        }
        Insert: {
          id?: string
          kind: Database["public"]["Enums"]["weight_log_kind"]
          order_item_id: string
          organization_id: string
          pieces?: number | null
          recorded_at?: string
          recorded_by: string
          weight_kg: number
        }
        Update: {
          id?: string
          kind?: Database["public"]["Enums"]["weight_log_kind"]
          order_item_id?: string
          organization_id?: string
          pieces?: number | null
          recorded_at?: string
          recorded_by?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_weight_log_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_weight_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          assignment_source: Database["public"]["Enums"]["assignment_source"]
          closed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_address: string
          delivery_date: string
          id: string
          loaded_at: string | null
          loaded_by: string | null
          loading_claimed_at: string | null
          loading_claimed_by: string | null
          notes: string | null
          organization_id: string
          postcode: string | null
          run_id: string | null
          run_sequence: number | null
          slot_id: string
          source: string
          status: Database["public"]["Enums"]["order_status"]
          total_amount: number
          truck_id: string
          updated_at: string
          version: number
          zone_id: string
        }
        Insert: {
          assignment_source?: Database["public"]["Enums"]["assignment_source"]
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivery_address: string
          delivery_date: string
          id?: string
          loaded_at?: string | null
          loaded_by?: string | null
          loading_claimed_at?: string | null
          loading_claimed_by?: string | null
          notes?: string | null
          organization_id: string
          postcode?: string | null
          run_id?: string | null
          run_sequence?: number | null
          slot_id: string
          source?: string
          status?: Database["public"]["Enums"]["order_status"]
          total_amount?: number
          truck_id: string
          updated_at?: string
          version?: number
          zone_id: string
        }
        Update: {
          assignment_source?: Database["public"]["Enums"]["assignment_source"]
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivery_address?: string
          delivery_date?: string
          id?: string
          loaded_at?: string | null
          loaded_by?: string | null
          loading_claimed_at?: string | null
          loading_claimed_by?: string | null
          notes?: string | null
          organization_id?: string
          postcode?: string | null
          run_id?: string | null
          run_sequence?: number | null
          slot_id?: string
          source?: string
          status?: Database["public"]["Enums"]["order_status"]
          total_amount?: number
          truck_id?: string
          updated_at?: string
          version?: number
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "delivery_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "delivery_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
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
          address: string | null
          created_at: string
          created_by: string | null
          default_locale: string
          default_time_zone: string
          email: string | null
          id: string
          legal_name: string | null
          name: string
          phone: string | null
          region: string | null
          registration_no: string | null
          slug: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          default_locale?: string
          default_time_zone?: string
          email?: string | null
          id?: string
          legal_name?: string | null
          name: string
          phone?: string | null
          region?: string | null
          registration_no?: string | null
          slug: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          default_locale?: string
          default_time_zone?: string
          email?: string | null
          id?: string
          legal_name?: string | null
          name?: string
          phone?: string | null
          region?: string | null
          registration_no?: string | null
          slug?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_available: boolean
          market_item_code: number | null
          market_margin_type: string | null
          market_margin_value: number | null
          name: string
          organization_id: string
          product_id: string
          unit_type: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_available?: boolean
          market_item_code?: number | null
          market_margin_type?: string | null
          market_margin_value?: number | null
          name: string
          organization_id: string
          product_id: string
          unit_type?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_available?: boolean
          market_item_code?: number | null
          market_margin_type?: string | null
          market_margin_value?: number | null
          name?: string
          organization_id?: string
          product_id?: string
          unit_type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          category_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          category_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
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
      public_holidays: {
        Row: {
          created_at: string
          holiday_date: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_capability_overrides: {
        Row: {
          capability: string
          changed_by: string | null
          created_at: string
          granted: boolean
          id: string
          organization_id: string
          reason: string | null
          role: string
          updated_at: string
        }
        Insert: {
          capability: string
          changed_by?: string | null
          created_at?: string
          granted: boolean
          id?: string
          organization_id: string
          reason?: string | null
          role: string
          updated_at?: string
        }
        Update: {
          capability?: string
          changed_by?: string | null
          created_at?: string
          granted?: boolean
          id?: string
          organization_id?: string
          reason?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_capability_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      run_stop_events: {
        Row: {
          at: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["stop_event_kind"]
          order_id: string
          organization_id: string
          recorded_by: string
          run_id: string
        }
        Insert: {
          at?: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["stop_event_kind"]
          order_id: string
          organization_id: string
          recorded_by: string
          run_id: string
        }
        Update: {
          at?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["stop_event_kind"]
          order_id?: string
          organization_id?: string
          recorded_by?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_stop_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_stop_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_stop_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "delivery_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_blocks: {
        Row: {
          block_date: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          reason: string | null
          truck_id: string | null
        }
        Insert: {
          block_date: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          reason?: string | null
          truck_id?: string | null
        }
        Update: {
          block_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          reason?: string | null
          truck_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_blocks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_blocks_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
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
      truck_zones: {
        Row: {
          organization_id: string
          truck_id: string
          zone_id: string
        }
        Insert: {
          organization_id: string
          truck_id: string
          zone_id: string
        }
        Update: {
          organization_id?: string
          truck_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "truck_zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "truck_zones_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "truck_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      trucks: {
        Row: {
          bay_id: string | null
          capacity_kg: number | null
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          bay_id?: string | null
          capacity_kg?: number | null
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          bay_id?: string | null
          capacity_kg?: number | null
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "trucks_bay_id_fkey"
            columns: ["bay_id"]
            isOneToOne: false
            referencedRelation: "bays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trucks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_postcode_ranges: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          postcode_end: string
          postcode_start: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          postcode_end: string
          postcode_start: string
          zone_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          postcode_end?: string
          postcode_start?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_postcode_ranges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_postcode_ranges_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _dc_uuid: { Args: { p_label: string; p_org: string }; Returns: string }
      _order_safe_boolean: { Args: { p_text: string }; Returns: boolean }
      _order_safe_integer: { Args: { p_text: string }; Returns: number }
      _order_safe_numeric: { Args: { p_text: string }; Returns: number }
      _order_safe_uuid: { Args: { p_text: string }; Returns: string }
      admin_clear_org_data: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      admin_seed_demo_data: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      admin_seed_realworld_data: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      admin_seed_setup_data: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      can_record_stop: {
        Args: { p_org: string; p_run: string }
        Returns: boolean
      }
      cancel_order: {
        Args: { p_order: string; p_reason: string }
        Returns: undefined
      }
      claim_weigh_task: {
        Args: { p_claim: boolean; p_task: string }
        Returns: undefined
      }
      close_order: { Args: { p_lines: Json; p_order: string }; Returns: number }
      complete_order_task: {
        Args: { p_task: string; p_weights: Json }
        Returns: undefined
      }
      confirm_order: {
        Args: { p_decisions: Json; p_order: string }
        Returns: undefined
      }
      current_actor_session_id: { Args: never; Returns: string }
      dispatch_assign_driver: {
        Args: { p_driver: string; p_run: string }
        Returns: undefined
      }
      dispatch_assign_order: {
        Args: {
          p_order: string
          p_source: Database["public"]["Enums"]["assignment_source"]
          p_truck: string
        }
        Returns: undefined
      }
      dispatch_claim_loading: {
        Args: { p_claim: boolean; p_order: string }
        Returns: undefined
      }
      dispatch_depart_truck: {
        Args: { p_date: string; p_truck: string }
        Returns: undefined
      }
      dispatch_reorder_run: {
        Args: { p_order_ids: string[]; p_run: string }
        Returns: undefined
      }
      dispatch_set_loaded: {
        Args: { p_loaded: boolean; p_order: string }
        Returns: undefined
      }
      dispatch_unassign_order: { Args: { p_order: string }; Returns: undefined }
      driver_arrive_stop: { Args: { p_order: string }; Returns: undefined }
      driver_deliver_stop: {
        Args: {
          p_cash_collected?: number
          p_lines?: Json
          p_order: string
          p_photo_path?: string
          p_received_by?: string
          p_signature_path?: string
        }
        Returns: number
      }
      driver_fail_stop: {
        Args: {
          p_next_action?: Database["public"]["Enums"]["delivery_next_action"]
          p_note?: string
          p_order: string
          p_reason: Database["public"]["Enums"]["delivery_failure_reason"]
        }
        Returns: undefined
      }
      driver_finish_run: { Args: { p_run: string }; Returns: undefined }
      driver_run_ids: { Args: never; Returns: string[] }
      driver_start_run: { Args: { p_run: string }; Returns: undefined }
      effective_capabilities:
        | { Args: { p_org: string }; Returns: Json }
        | { Args: { p_org: string; p_role: string }; Returns: Json }
      extract_postcode: { Args: { p_address: string }; Returns: string }
      get_dashboard_insights: {
        Args: { p_from: string; p_organization_id: string; p_to: string }
        Returns: Json
      }
      get_dashboard_sales: {
        Args: {
          p_bucket?: string
          p_from: string
          p_organization_id: string
          p_to: string
        }
        Returns: Json
      }
      get_dashboard_today: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_delivery_options: {
        Args: { p_org: string; p_zone: string }
        Returns: {
          end_time: string
          option_date: string
          remaining: number
          slot_id: string
          start_time: string
          truck_id: string
          truck_name: string
        }[]
      }
      get_market_suggestions: {
        Args: { p_organization_id: string }
        Returns: {
          current_price: number
          latest_price_date: string
          market_base: number
          market_item_code: number
          product_name: string
          stale: boolean
          suggested_price: number
          variant_id: string
          variant_name: string
        }[]
      }
      has_org_role: {
        Args: { roles: string[]; target_org: string }
        Returns: boolean
      }
      is_active_org_member: { Args: { target_org: string }; Returns: boolean }
      is_break_glass_active: { Args: { target_org: string }; Returns: boolean }
      is_org_driver: { Args: { target_org: string }; Returns: boolean }
      link_or_create_customer_for_buyer: {
        Args: { p_buyer_id: string }
        Returns: undefined
      }
      normalize_phone: { Args: { p_raw: string }; Returns: string }
      place_order: {
        Args: {
          p_address: string
          p_customer?: string
          p_date: string
          p_items: Json
          p_notes: string
          p_org: string
          p_postcode?: string
          p_slot: string
          p_zone: string
        }
        Returns: string
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
      reopen_order: {
        Args: { p_order: string; p_reason: string }
        Returns: undefined
      }
      resolve_zone_for_postcode: {
        Args: { p_org: string; p_postcode: string }
        Returns: string
      }
      role_rank: { Args: { role: string }; Returns: number }
      set_run_status: {
        Args: {
          p_run: string
          p_status: Database["public"]["Enums"]["delivery_run_status"]
        }
        Returns: undefined
      }
    }
    Enums: {
      assignment_source: "none" | "auto" | "manual"
      delivery_failure_reason:
        | "shop_closed"
        | "rejected"
        | "no_cash"
        | "wrong_address"
        | "other"
      delivery_next_action: "retry_today" | "move_tomorrow" | "return_to_yard"
      delivery_outcome: "delivered" | "failed"
      delivery_run_status: "planned" | "departed" | "completed"
      order_fallback: "cancel" | "mix" | "upsize" | "downsize"
      order_item_mode: "piece" | "kg"
      order_status:
        | "pending"
        | "confirmed"
        | "ready"
        | "delivered"
        | "closed"
        | "cancelled"
      order_task_status: "pending" | "done"
      stop_event_kind: "arrive" | "leave"
      weight_log_kind: "warehouse" | "final"
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
    Enums: {
      assignment_source: ["none", "auto", "manual"],
      delivery_failure_reason: [
        "shop_closed",
        "rejected",
        "no_cash",
        "wrong_address",
        "other",
      ],
      delivery_next_action: ["retry_today", "move_tomorrow", "return_to_yard"],
      delivery_outcome: ["delivered", "failed"],
      delivery_run_status: ["planned", "departed", "completed"],
      order_fallback: ["cancel", "mix", "upsize", "downsize"],
      order_item_mode: ["piece", "kg"],
      order_status: [
        "pending",
        "confirmed",
        "ready",
        "delivered",
        "closed",
        "cancelled",
      ],
      order_task_status: ["pending", "done"],
      stop_event_kind: ["arrive", "leave"],
      weight_log_kind: ["warehouse", "final"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

