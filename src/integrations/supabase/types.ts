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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      broker_commissions: {
        Row: {
          commission_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          commission_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          commission_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      carriers: {
        Row: {
          address: string | null
          agreement_signed: boolean
          authority_status: string
          auto_liability: number | null
          cargo_insurance: number | null
          city: string | null
          coi_received: boolean
          contact_name: string | null
          created_at: string
          dba: string | null
          dnu_reason: string | null
          dot_number: string | null
          email: string | null
          equipment: string | null
          factoring_company: string | null
          factoring_remit: string | null
          id: string
          insurance_expires: string | null
          legal_name: string
          mc_number: string | null
          phone: string | null
          safety_rating: string | null
          state: string | null
          status: Database["public"]["Enums"]["carrier_status"]
          w9_received: boolean
          zip: string | null
        }
        Insert: {
          address?: string | null
          agreement_signed?: boolean
          authority_status?: string
          auto_liability?: number | null
          cargo_insurance?: number | null
          city?: string | null
          coi_received?: boolean
          contact_name?: string | null
          created_at?: string
          dba?: string | null
          dnu_reason?: string | null
          dot_number?: string | null
          email?: string | null
          equipment?: string | null
          factoring_company?: string | null
          factoring_remit?: string | null
          id?: string
          insurance_expires?: string | null
          legal_name: string
          mc_number?: string | null
          phone?: string | null
          safety_rating?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["carrier_status"]
          w9_received?: boolean
          zip?: string | null
        }
        Update: {
          address?: string | null
          agreement_signed?: boolean
          authority_status?: string
          auto_liability?: number | null
          cargo_insurance?: number | null
          city?: string | null
          coi_received?: boolean
          contact_name?: string | null
          created_at?: string
          dba?: string | null
          dnu_reason?: string | null
          dot_number?: string | null
          email?: string | null
          equipment?: string | null
          factoring_company?: string | null
          factoring_remit?: string | null
          id?: string
          insurance_expires?: string | null
          legal_name?: string
          mc_number?: string | null
          phone?: string | null
          safety_rating?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["carrier_status"]
          w9_received?: boolean
          zip?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          address: string | null
          city: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          kind: string
          name: string
          notes: string | null
          phone: string | null
          state: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          kind: string
          name: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      drivers: {
        Row: {
          cdl_expires: string | null
          cdl_number: string | null
          cdl_state: string | null
          created_at: string
          email: string | null
          full_name: string
          home_city: string | null
          id: string
          medical_expires: string | null
          phone: string | null
          status: string
        }
        Insert: {
          cdl_expires?: string | null
          cdl_number?: string | null
          cdl_state?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          home_city?: string | null
          id?: string
          medical_expires?: string | null
          phone?: string | null
          status?: string
        }
        Update: {
          cdl_expires?: string | null
          cdl_number?: string | null
          cdl_state?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          home_city?: string | null
          id?: string
          medical_expires?: string | null
          phone?: string | null
          status?: string
        }
        Relationships: []
      }
      fleet_units: {
        Row: {
          created_at: string
          equipment: string | null
          id: string
          kind: string
          make_model: string | null
          notes: string | null
          plate: string | null
          status: string
          unit_number: string
          vin: string | null
          year: number | null
        }
        Insert: {
          created_at?: string
          equipment?: string | null
          id?: string
          kind: string
          make_model?: string | null
          notes?: string | null
          plate?: string | null
          status?: string
          unit_number: string
          vin?: string | null
          year?: number | null
        }
        Update: {
          created_at?: string
          equipment?: string | null
          id?: string
          kind?: string
          make_model?: string | null
          notes?: string | null
          plate?: string | null
          status?: string
          unit_number?: string
          vin?: string | null
          year?: number | null
        }
        Relationships: []
      }
      loads: {
        Row: {
          accessorials: Json
          broker_id: string | null
          carrier_id: string | null
          carrier_rate: number
          commodity: string | null
          consignee_id: string | null
          created_at: string
          customer_id: string | null
          customer_rate: number
          delivery_at: string | null
          delivery_notes: string | null
          dest_city: string
          dest_state: string
          driver_id: string | null
          equipment: string
          id: string
          last_check_call: string | null
          load_number: string
          miles: number | null
          origin_city: string
          origin_state: string
          pickup_at: string | null
          pickup_notes: string | null
          pieces: number | null
          pod_received: boolean
          ratecon_signed: boolean
          shipper_id: string | null
          status: Database["public"]["Enums"]["load_status"]
          temperature: string | null
          trailer_id: string | null
          truck_id: string | null
          weight_lbs: number | null
        }
        Insert: {
          accessorials?: Json
          broker_id?: string | null
          carrier_id?: string | null
          carrier_rate?: number
          commodity?: string | null
          consignee_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_rate?: number
          delivery_at?: string | null
          delivery_notes?: string | null
          dest_city: string
          dest_state: string
          driver_id?: string | null
          equipment?: string
          id?: string
          last_check_call?: string | null
          load_number?: string
          miles?: number | null
          origin_city: string
          origin_state: string
          pickup_at?: string | null
          pickup_notes?: string | null
          pieces?: number | null
          pod_received?: boolean
          ratecon_signed?: boolean
          shipper_id?: string | null
          status?: Database["public"]["Enums"]["load_status"]
          temperature?: string | null
          trailer_id?: string | null
          truck_id?: string | null
          weight_lbs?: number | null
        }
        Update: {
          accessorials?: Json
          broker_id?: string | null
          carrier_id?: string | null
          carrier_rate?: number
          commodity?: string | null
          consignee_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_rate?: number
          delivery_at?: string | null
          delivery_notes?: string | null
          dest_city?: string
          dest_state?: string
          driver_id?: string | null
          equipment?: string
          id?: string
          last_check_call?: string | null
          load_number?: string
          miles?: number | null
          origin_city?: string
          origin_state?: string
          pickup_at?: string | null
          pickup_notes?: string | null
          pieces?: number | null
          pod_received?: boolean
          ratecon_signed?: boolean
          shipper_id?: string | null
          status?: Database["public"]["Enums"]["load_status"]
          temperature?: string | null
          trailer_id?: string | null
          truck_id?: string | null
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loads_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_consignee_id_fkey"
            columns: ["consignee_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_shipper_id_fkey"
            columns: ["shipper_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_trailer_id_fkey"
            columns: ["trailer_id"]
            isOneToOne: false
            referencedRelation: "fleet_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "fleet_units"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      qb_sync: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          kind: string
          load_id: string
          payee: string | null
          qb_ref: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          kind: string
          load_id: string
          payee?: string | null
          qb_ref?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          kind?: string
          load_id?: string
          payee?: string | null
          qb_ref?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_sync_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "broker"
      carrier_status: "pending" | "vetted" | "dnu"
      load_status:
        | "available"
        | "vetting"
        | "booked"
        | "dispatched"
        | "rolling"
        | "delivered"
        | "invoiced"
        | "paid"
        | "issue"
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
      app_role: ["admin", "broker"],
      carrier_status: ["pending", "vetted", "dnu"],
      load_status: [
        "available",
        "vetting",
        "booked",
        "dispatched",
        "rolling",
        "delivered",
        "invoiced",
        "paid",
        "issue",
      ],
    },
  },
} as const
