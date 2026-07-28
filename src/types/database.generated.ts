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
      product_variants: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_available: boolean
          name: string
          organization_id: string
          price_per_unit: number
          product_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_available?: boolean
          name: string
          organization_id: string
          price_per_unit: number
          product_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_available?: boolean
          name?: string
          organization_id?: string
          price_per_unit?: number
          product_id?: string
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
      customers: {
        Row: {
          address: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string
          updated_at: string
          version: number
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone: string
          updated_at?: string
          version?: number
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string
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
      orders: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          notes: string | null
          organization_id: string
          seller_id: string
          status: string
          total_amount: number
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          notes?: string | null
          organization_id: string
          seller_id: string
          status?: string
          total_amount?: number
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          seller_id?: string
          status?: string
          total_amount?: number
          updated_at?: string
          version?: number
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
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          quantity: number
          subtotal: number
          unit_price: number
          variant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          quantity: number
          subtotal: number
          unit_price: number
          variant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          quantity?: number
          subtotal?: number
          unit_price?: number
          variant_id?: string
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
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
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
      effective_capabilities: {
        Args: { p_org: string }
        Returns: Json
      }
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
      order_status: "new" | "preparing" | "ready" | "completed" | "cancelled"
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
