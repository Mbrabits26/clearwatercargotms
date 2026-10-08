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
      app_user_connections: {
        Row: {
          connection_key_ciphertext: string
          connector_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_key_ciphertext: string
          connector_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_key_ciphertext?: string
          connector_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      approved_users: {
        Row: {
          approved_by: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          perms: string[]
          role: Database["public"]["Enums"]["app_role"]
          user_id: string | null
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          perms?: string[]
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string | null
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          perms?: string[]
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string | null
        }
        Relationships: []
      }
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
      carrier_documents: {
        Row: {
          carrier_id: string
          expires_on: string | null
          file_name: string | null
          file_path: string
          id: string
          kind: string
          source: string
          uploaded_at: string
        }
        Insert: {
          carrier_id: string
          expires_on?: string | null
          file_name?: string | null
          file_path: string
          id?: string
          kind: string
          source?: string
          uploaded_at?: string
        }
        Update: {
          carrier_id?: string
          expires_on?: string | null
          file_name?: string | null
          file_path?: string
          id?: string
          kind?: string
          source?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_documents_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_invites: {
        Row: {
          carrier_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          expires_at: string
          id: string
          status: string
          submitted_at: string | null
          token: string
        }
        Insert: {
          carrier_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          status?: string
          submitted_at?: string | null
          token?: string
        }
        Update: {
          carrier_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          status?: string
          submitted_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_invites_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          address: string | null
          agreement_signed: boolean
          authority_status: string
          auto_liability: number | null
          cargo_expires: string | null
          cargo_insurance: number | null
          city: string | null
          coi_received: boolean
          conditional_by: string | null
          conditional_note: string | null
          conditional_until: string | null
          contact_name: string | null
          created_at: string
          dba: string | null
          dnu_reason: string | null
          dot_number: string | null
          email: string | null
          equipment: string | null
          factoring_company: string | null
          factoring_remit: string | null
          factoring_remit_address: string | null
          id: string
          insurance_expires: string | null
          legal_name: string
          mc_number: string | null
          noa_received: boolean
          pay_terms: string
          phone: string | null
          safety_rating: string | null
          state: string | null
          status: Database["public"]["Enums"]["carrier_status"]
          voided_check_received: boolean
          w9_received: boolean
          zip: string | null
        }
        Insert: {
          address?: string | null
          agreement_signed?: boolean
          authority_status?: string
          auto_liability?: number | null
          cargo_expires?: string | null
          cargo_insurance?: number | null
          city?: string | null
          coi_received?: boolean
          conditional_by?: string | null
          conditional_note?: string | null
          conditional_until?: string | null
          contact_name?: string | null
          created_at?: string
          dba?: string | null
          dnu_reason?: string | null
          dot_number?: string | null
          email?: string | null
          equipment?: string | null
          factoring_company?: string | null
          factoring_remit?: string | null
          factoring_remit_address?: string | null
          id?: string
          insurance_expires?: string | null
          legal_name: string
          mc_number?: string | null
          noa_received?: boolean
          pay_terms?: string
          phone?: string | null
          safety_rating?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["carrier_status"]
          voided_check_received?: boolean
          w9_received?: boolean
          zip?: string | null
        }
        Update: {
          address?: string | null
          agreement_signed?: boolean
          authority_status?: string
          auto_liability?: number | null
          cargo_expires?: string | null
          cargo_insurance?: number | null
          city?: string | null
          coi_received?: boolean
          conditional_by?: string | null
          conditional_note?: string | null
          conditional_until?: string | null
          contact_name?: string | null
          created_at?: string
          dba?: string | null
          dnu_reason?: string | null
          dot_number?: string | null
          email?: string | null
          equipment?: string | null
          factoring_company?: string | null
          factoring_remit?: string | null
          factoring_remit_address?: string | null
          id?: string
          insurance_expires?: string | null
          legal_name?: string
          mc_number?: string | null
          noa_received?: boolean
          pay_terms?: string
          phone?: string | null
          safety_rating?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["carrier_status"]
          voided_check_received?: boolean
          w9_received?: boolean
          zip?: string | null
        }
        Relationships: []
      }
      chat_mentions: {
        Row: {
          author_id: string
          body: string
          channel: string | null
          created_at: string
          id: string
          load_id: string | null
          read: boolean
          source: string
          user_id: string
        }
        Insert: {
          author_id?: string
          body: string
          channel?: string | null
          created_at?: string
          id?: string
          load_id?: string | null
          read?: boolean
          source: string
          user_id: string
        }
        Update: {
          author_id?: string
          body?: string
          channel?: string | null
          created_at?: string
          id?: string
          load_id?: string | null
          read?: boolean
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_mentions_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          author_id: string
          body: string
          channel: string
          created_at: string
          id: string
        }
        Insert: {
          author_id?: string
          body: string
          channel: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string
          body?: string
          channel?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      chat_reads: {
        Row: {
          channel: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel: string
          last_read_at?: string
          user_id?: string
        }
        Update: {
          channel?: string
          last_read_at?: string
          user_id?: string
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
      lead_activities: {
        Row: {
          author_id: string | null
          created_at: string
          follow_up: string | null
          id: string
          lead_id: string
          method: string
          notes: string | null
          occurred_at: string
        }
        Insert: {
          author_id?: string | null
          created_at?: string
          follow_up?: string | null
          id?: string
          lead_id: string
          method?: string
          notes?: string | null
          occurred_at?: string
        }
        Update: {
          author_id?: string | null
          created_at?: string
          follow_up?: string | null
          id?: string
          lead_id?: string
          method?: string
          notes?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          city: string | null
          company_id: string | null
          company_name: string
          contact_name: string | null
          created_at: string
          email: string | null
          est_monthly_loads: number | null
          id: string
          lanes: string | null
          lost_reason: string | null
          next_follow_up: string | null
          owner_id: string | null
          phone: string | null
          source: string | null
          stage: string
          state: string | null
        }
        Insert: {
          city?: string | null
          company_id?: string | null
          company_name: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          est_monthly_loads?: number | null
          id?: string
          lanes?: string | null
          lost_reason?: string | null
          next_follow_up?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: string | null
          stage?: string
          state?: string | null
        }
        Update: {
          city?: string | null
          company_id?: string | null
          company_name?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          est_monthly_loads?: number | null
          id?: string
          lanes?: string | null
          lost_reason?: string | null
          next_follow_up?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: string | null
          stage?: string
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      load_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          load_id: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          id?: string
          load_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          load_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_notes_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      load_offers: {
        Row: {
          carrier_id: string
          counter_rate: number | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          load_id: string
          note: string | null
          offered_rate: number
          responded_at: string | null
          status: string
          token: string
        }
        Insert: {
          carrier_id: string
          counter_rate?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          load_id: string
          note?: string | null
          offered_rate?: number
          responded_at?: string | null
          status?: string
          token?: string
        }
        Update: {
          carrier_id?: string
          counter_rate?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          load_id?: string
          note?: string | null
          offered_rate?: number
          responded_at?: string | null
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_offers_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_offers_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      load_tracking_pings: {
        Row: {
          created_at: string
          id: string
          kind: string
          lat: number | null
          lng: number | null
          load_id: string
          note: string | null
          place: string | null
          status: string | null
          token_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          load_id: string
          note?: string | null
          place?: string | null
          status?: string | null
          token_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          load_id?: string
          note?: string | null
          place?: string | null
          status?: string | null
          token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "load_tracking_pings_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_tracking_pings_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "load_tracking_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      load_tracking_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          driver_name: string | null
          driver_phone: string | null
          expires_at: string
          id: string
          load_id: string
          status: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          expires_at?: string
          id?: string
          load_id: string
          status?: string
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          expires_at?: string
          id?: string
          load_id?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_tracking_tokens_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      loads: {
        Row: {
          accessorials: Json
          broker_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
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
          dest_ref: string | null
          dest_state: string
          driver_id: string | null
          equipment: string
          id: string
          last_check_call: string | null
          load_number: string
          miles: number | null
          origin_city: string
          origin_state: string
          override_at: string | null
          override_by: string | null
          override_reason: string | null
          pay_terms: string | null
          pickup_at: string | null
          pickup_notes: string | null
          pieces: number | null
          pod_received: boolean
          ratecon_pdf_path: string | null
          ratecon_signed: boolean
          ship_ref: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          dest_ref?: string | null
          dest_state: string
          driver_id?: string | null
          equipment?: string
          id?: string
          last_check_call?: string | null
          load_number?: string
          miles?: number | null
          origin_city: string
          origin_state: string
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          pay_terms?: string | null
          pickup_at?: string | null
          pickup_notes?: string | null
          pieces?: number | null
          pod_received?: boolean
          ratecon_pdf_path?: string | null
          ratecon_signed?: boolean
          ship_ref?: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          dest_ref?: string | null
          dest_state?: string
          driver_id?: string | null
          equipment?: string
          id?: string
          last_check_call?: string | null
          load_number?: string
          miles?: number | null
          origin_city?: string
          origin_state?: string
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          pay_terms?: string | null
          pickup_at?: string | null
          pickup_notes?: string | null
          pieces?: number | null
          pod_received?: boolean
          ratecon_pdf_path?: string | null
          ratecon_signed?: boolean
          ship_ref?: string | null
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
      market_rate_cache: {
        Row: {
          fetched_at: string
          key: string
          result: Json
        }
        Insert: {
          fetched_at?: string
          key: string
          result: Json
        }
        Update: {
          fetched_at?: string
          key?: string
          result?: Json
        }
        Relationships: []
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
          carrier_invoice_amount: number | null
          carrier_invoice_path: string | null
          created_at: string
          created_by: string | null
          error: string | null
          gross_amount: number | null
          id: string
          invoice_number: string | null
          kind: string
          load_id: string
          payee: string | null
          qb_ref: string | null
          quickpay_fee: number
          sent_at: string | null
          status: string
        }
        Insert: {
          amount?: number
          carrier_invoice_amount?: number | null
          carrier_invoice_path?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          gross_amount?: number | null
          id?: string
          invoice_number?: string | null
          kind: string
          load_id: string
          payee?: string | null
          qb_ref?: string | null
          quickpay_fee?: number
          sent_at?: string | null
          status?: string
        }
        Update: {
          amount?: number
          carrier_invoice_amount?: number | null
          carrier_invoice_path?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          gross_amount?: number | null
          id?: string
          invoice_number?: string | null
          kind?: string
          load_id?: string
          payee?: string | null
          qb_ref?: string | null
          quickpay_fee?: number
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
      quotes: {
        Row: {
          accessorials: Json
          broker_id: string | null
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          dest_city: string
          dest_state: string
          equipment: string
          expires_at: string
          id: string
          kind: string
          load_id: string | null
          lost_reason: string | null
          miles: number | null
          notes: string | null
          origin_city: string
          origin_state: string
          pickup_date: string | null
          quote_number: string
          rate: number
          status: string
          target_carrier_rate: number | null
        }
        Insert: {
          accessorials?: Json
          broker_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          dest_city: string
          dest_state: string
          equipment?: string
          expires_at?: string
          id?: string
          kind?: string
          load_id?: string | null
          lost_reason?: string | null
          miles?: number | null
          notes?: string | null
          origin_city: string
          origin_state: string
          pickup_date?: string | null
          quote_number?: string
          rate?: number
          status?: string
          target_carrier_rate?: number | null
        }
        Update: {
          accessorials?: Json
          broker_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          dest_city?: string
          dest_state?: string
          equipment?: string
          expires_at?: string
          id?: string
          kind?: string
          load_id?: string | null
          lost_reason?: string | null
          miles?: number | null
          notes?: string | null
          origin_city?: string
          origin_state?: string
          pickup_date?: string | null
          quote_number?: string
          rate?: number
          status?: string
          target_carrier_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      ratecon_requests: {
        Row: {
          carrier_email: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          load_id: string
          pdf_path: string | null
          signed_at: string | null
          signer_name: string | null
          signer_title: string | null
          snapshot: Json
          status: string
          token: string
        }
        Insert: {
          carrier_email?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          load_id: string
          pdf_path?: string | null
          signed_at?: string | null
          signer_name?: string | null
          signer_title?: string | null
          snapshot: Json
          status?: string
          token?: string
        }
        Update: {
          carrier_email?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          load_id?: string
          pdf_path?: string | null
          signed_at?: string | null
          signer_name?: string | null
          signer_title?: string | null
          snapshot?: Json
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratecon_requests_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          perms: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          perms?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          perms?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      carrier_lane_history: {
        Row: {
          avg_rate: number | null
          avg_rpm: number | null
          carrier_id: string | null
          dest_city: string | null
          dest_state: string | null
          equipment: string | null
          last_run: string | null
          origin_city: string | null
          origin_state: string | null
          runs: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loads_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_approved: { Args: { _uid: string }; Returns: boolean }
      is_staff: { Args: { _uid: string }; Returns: boolean }
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
        | "cancelled"
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
        "cancelled",
      ],
    },
  },
} as const
