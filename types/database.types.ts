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
      activation_cibles: {
        Row: {
          erreur: string | null
          etat_avant: Json | null
          id: string
          line_item_id: string
          line_item_nom: string | null
          lot_id: string
          maj_le: string
          statut: string
        }
        Insert: {
          erreur?: string | null
          etat_avant?: Json | null
          id?: string
          line_item_id: string
          line_item_nom?: string | null
          lot_id: string
          maj_le?: string
          statut?: string
        }
        Update: {
          erreur?: string | null
          etat_avant?: Json | null
          id?: string
          line_item_id?: string
          line_item_nom?: string | null
          lot_id?: string
          maj_le?: string
          statut?: string
        }
        Relationships: [
          {
            foreignKeyName: "activation_cibles_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "activation_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      activation_lots: {
        Row: {
          campaign_id: string
          canal: string
          id: string
          lance_le: string
          lance_par: string
          org_id: string
          statut: string
          termine_le: string | null
          version_strategie: number | null
        }
        Insert: {
          campaign_id: string
          canal: string
          id?: string
          lance_le?: string
          lance_par: string
          org_id: string
          statut?: string
          termine_le?: string | null
          version_strategie?: number | null
        }
        Update: {
          campaign_id?: string
          canal?: string
          id?: string
          lance_le?: string
          lance_par?: string
          org_id?: string
          statut?: string
          termine_le?: string | null
          version_strategie?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "activation_lots_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dsp_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      adaptive_model_state: {
        Row: {
          algorithm_code: string
          hyperparameters: Json
          id: string
          is_active: boolean
          model_version: string
          notes: string | null
          parameters: Json
          performance_metrics: Json
          promoted_at: string | null
          retired_at: string | null
          strategy_id: string
          trained_at: string
          training_window_end: string | null
          training_window_start: string | null
        }
        Insert: {
          algorithm_code: string
          hyperparameters?: Json
          id?: string
          is_active?: boolean
          model_version: string
          notes?: string | null
          parameters: Json
          performance_metrics?: Json
          promoted_at?: string | null
          retired_at?: string | null
          strategy_id: string
          trained_at?: string
          training_window_end?: string | null
          training_window_start?: string | null
        }
        Update: {
          algorithm_code?: string
          hyperparameters?: Json
          id?: string
          is_active?: boolean
          model_version?: string
          notes?: string | null
          parameters?: Json
          performance_metrics?: Json
          promoted_at?: string | null
          retired_at?: string | null
          strategy_id?: string
          trained_at?: string
          training_window_end?: string | null
          training_window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "adaptive_model_state_algorithm_code_fkey"
            columns: ["algorithm_code"]
            isOneToOne: false
            referencedRelation: "bidding_algorithms"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "adaptive_model_state_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_autonomy_settings: {
        Row: {
          autonomy_enabled: boolean
          autonomy_level: number
          autonomy_max_actions_per_day: number
          autonomy_max_budget_delta_pct: number
          autonomy_max_curve_delta_pct: number
          config: Json
          created_at: string
          id: string
          scope_type: string
          strategy_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          autonomy_enabled?: boolean
          autonomy_level: number
          autonomy_max_actions_per_day?: number
          autonomy_max_budget_delta_pct?: number
          autonomy_max_curve_delta_pct?: number
          config?: Json
          created_at?: string
          id?: string
          scope_type: string
          strategy_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          autonomy_enabled?: boolean
          autonomy_level?: number
          autonomy_max_actions_per_day?: number
          autonomy_max_budget_delta_pct?: number
          autonomy_max_curve_delta_pct?: number
          config?: Json
          created_at?: string
          id?: string
          scope_type?: string
          strategy_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_autonomy_settings_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          strategy_id: string
          tool_calls: Json | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          strategy_id: string
          tool_calls?: Json | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          strategy_id?: string
          tool_calls?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_chat_messages_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_recommendations: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          body: string
          category: string
          data_hash: string | null
          generated_at: string
          id: string
          model: string | null
          proposed_action: Json | null
          severity: string
          status: string
          strategy_id: string
          title: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          body: string
          category: string
          data_hash?: string | null
          generated_at?: string
          id?: string
          model?: string | null
          proposed_action?: Json | null
          severity: string
          status?: string
          strategy_id: string
          title: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          body?: string
          category?: string
          data_hash?: string | null
          generated_at?: string
          id?: string
          model?: string | null
          proposed_action?: Json | null
          severity?: string
          status?: string
          strategy_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_recommendations_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      analyses: {
        Row: {
          created_at: string
          created_by: string
          erreur: string | null
          id: string
          maillage: string | null
          nom: string
          org_id: string
          parametres: Json
          perimetre: Json | null
          resultat: Json | null
          statut: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          erreur?: string | null
          id?: string
          maillage?: string | null
          nom: string
          org_id: string
          parametres: Json
          perimetre?: Json | null
          resultat?: Json | null
          statut?: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          erreur?: string | null
          id?: string
          maillage?: string | null
          nom?: string
          org_id?: string
          parametres?: Json
          perimetre?: Json | null
          resultat?: Json | null
          statut?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      atmo_map_daily: {
        Row: {
          code_postal: string
          date_ech: string
          indice_global: number
          nb_communes: number
          no2: number
          o3: number
          pm10: number
          pm25: number
          so2: number
          updated_at: string
        }
        Insert: {
          code_postal: string
          date_ech: string
          indice_global?: number
          nb_communes?: number
          no2?: number
          o3?: number
          pm10?: number
          pm25?: number
          so2?: number
          updated_at?: string
        }
        Update: {
          code_postal?: string
          date_ech?: string
          indice_global?: number
          nb_communes?: number
          no2?: number
          o3?: number
          pm10?: number
          pm25?: number
          so2?: number
          updated_at?: string
        }
        Relationships: []
      }
      bidding_agent_actions: {
        Row: {
          action_taken: string | null
          agent_response: string | null
          applied_at: string | null
          autonomy_level_at_time: number | null
          created_at: string
          drift_event_id: string | null
          id: string
          intent: string
          llm_duration_ms: number | null
          llm_model: string | null
          llm_tokens_input: number | null
          llm_tokens_output: number | null
          recommendations: Json | null
          strategy_id: string | null
          trigger_source: string
          user_id: string | null
          user_message: string | null
        }
        Insert: {
          action_taken?: string | null
          agent_response?: string | null
          applied_at?: string | null
          autonomy_level_at_time?: number | null
          created_at?: string
          drift_event_id?: string | null
          id?: string
          intent: string
          llm_duration_ms?: number | null
          llm_model?: string | null
          llm_tokens_input?: number | null
          llm_tokens_output?: number | null
          recommendations?: Json | null
          strategy_id?: string | null
          trigger_source: string
          user_id?: string | null
          user_message?: string | null
        }
        Update: {
          action_taken?: string | null
          agent_response?: string | null
          applied_at?: string | null
          autonomy_level_at_time?: number | null
          created_at?: string
          drift_event_id?: string | null
          id?: string
          intent?: string
          llm_duration_ms?: number | null
          llm_model?: string | null
          llm_tokens_input?: number | null
          llm_tokens_output?: number | null
          recommendations?: Json | null
          strategy_id?: string | null
          trigger_source?: string
          user_id?: string | null
          user_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bidding_agent_actions_drift_event_id_fkey"
            columns: ["drift_event_id"]
            isOneToOne: false
            referencedRelation: "bidding_drift_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bidding_agent_actions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      bidding_algorithms: {
        Row: {
          code: string
          config_schema: Json
          created_at: string
          description: string | null
          display_name: string
          display_name_fr: string | null
          display_order: number
          family: string
          is_baseline: boolean
          is_enabled: boolean
          library: string | null
          supports_drift_detection: boolean
          supports_online_learning: boolean
        }
        Insert: {
          code: string
          config_schema?: Json
          created_at?: string
          description?: string | null
          display_name: string
          display_name_fr?: string | null
          display_order?: number
          family: string
          is_baseline?: boolean
          is_enabled?: boolean
          library?: string | null
          supports_drift_detection?: boolean
          supports_online_learning?: boolean
        }
        Update: {
          code?: string
          config_schema?: Json
          created_at?: string
          description?: string | null
          display_name?: string
          display_name_fr?: string | null
          display_order?: number
          family?: string
          is_baseline?: boolean
          is_enabled?: boolean
          library?: string | null
          supports_drift_detection?: boolean
          supports_online_learning?: boolean
        }
        Relationships: []
      }
      bidding_curve_history: {
        Row: {
          applied_at: string
          curve: Json
          delta_pct: Json | null
          id: string
          reason: string | null
          reference_id: string | null
          strategy_id: string
          triggered_by: string
        }
        Insert: {
          applied_at: string
          curve: Json
          delta_pct?: Json | null
          id?: string
          reason?: string | null
          reference_id?: string | null
          strategy_id: string
          triggered_by: string
        }
        Update: {
          applied_at?: string
          curve?: Json
          delta_pct?: Json | null
          id?: string
          reason?: string | null
          reference_id?: string | null
          strategy_id?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "bidding_curve_history_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      bidding_daily_state: {
        Row: {
          applied_bid_multiplier: number
          clicks: number
          conversions: number
          country_code: string
          created_at: string
          date: string
          id: number
          impressions: number
          metrics: Json
          model_decision: Json | null
          postal_code: string
          revenue: number | null
          spend: number
          strategy_id: string
        }
        Insert: {
          applied_bid_multiplier: number
          clicks?: number
          conversions?: number
          country_code?: string
          created_at?: string
          date: string
          id?: number
          impressions?: number
          metrics?: Json
          model_decision?: Json | null
          postal_code: string
          revenue?: number | null
          spend?: number
          strategy_id: string
        }
        Update: {
          applied_bid_multiplier?: number
          clicks?: number
          conversions?: number
          country_code?: string
          created_at?: string
          date?: string
          id?: number
          impressions?: number
          metrics?: Json
          model_decision?: Json | null
          postal_code?: string
          revenue?: number | null
          spend?: number
          strategy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bidding_daily_state_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      bidding_drift_events: {
        Row: {
          agent_analyzed_at: string | null
          agent_recommendation: Json | null
          auto_action: string | null
          country_code: string | null
          created_at: string
          delta: number | null
          description: string | null
          detected_at: string
          drift_type: string
          id: string
          metric_after: Json | null
          metric_before: Json | null
          model_state_id: string | null
          postal_code: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          strategy_id: string
          threshold: number | null
        }
        Insert: {
          agent_analyzed_at?: string | null
          agent_recommendation?: Json | null
          auto_action?: string | null
          country_code?: string | null
          created_at?: string
          delta?: number | null
          description?: string | null
          detected_at?: string
          drift_type: string
          id?: string
          metric_after?: Json | null
          metric_before?: Json | null
          model_state_id?: string | null
          postal_code?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          strategy_id: string
          threshold?: number | null
        }
        Update: {
          agent_analyzed_at?: string | null
          agent_recommendation?: Json | null
          auto_action?: string | null
          country_code?: string | null
          created_at?: string
          delta?: number | null
          description?: string | null
          detected_at?: string
          drift_type?: string
          id?: string
          metric_after?: Json | null
          metric_before?: Json | null
          model_state_id?: string | null
          postal_code?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          strategy_id?: string
          threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bidding_drift_events_model_state_id_fkey"
            columns: ["model_state_id"]
            isOneToOne: false
            referencedRelation: "adaptive_model_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bidding_drift_events_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      bidding_objectives: {
        Row: {
          code: string
          description: string | null
          display_name: string
          display_name_fr: string | null
          display_order: number
          formula: string | null
          is_enabled: boolean
          optimization_direction: string
          required_metrics: Json
          unit: string | null
        }
        Insert: {
          code: string
          description?: string | null
          display_name: string
          display_name_fr?: string | null
          display_order?: number
          formula?: string | null
          is_enabled?: boolean
          optimization_direction: string
          required_metrics?: Json
          unit?: string | null
        }
        Update: {
          code?: string
          description?: string | null
          display_name?: string
          display_name_fr?: string | null
          display_order?: number
          formula?: string | null
          is_enabled?: boolean
          optimization_direction?: string
          required_metrics?: Json
          unit?: string | null
        }
        Relationships: []
      }
      bidding_simulations: {
        Row: {
          baseline_metrics: Json | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          delta: Json | null
          error_message: string | null
          id: string
          name: string
          parameters: Json
          simulated_metrics: Json | null
          started_at: string | null
          status: string
          strategy_id: string | null
          zone_results: Json | null
        }
        Insert: {
          baseline_metrics?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          delta?: Json | null
          error_message?: string | null
          id?: string
          name: string
          parameters: Json
          simulated_metrics?: Json | null
          started_at?: string | null
          status?: string
          strategy_id?: string | null
          zone_results?: Json | null
        }
        Update: {
          baseline_metrics?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          delta?: Json | null
          error_message?: string | null
          id?: string
          name?: string
          parameters?: Json
          simulated_metrics?: Json | null
          started_at?: string | null
          status?: string
          strategy_id?: string | null
          zone_results?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bidding_simulations_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      bidding_strategies: {
        Row: {
          activated_at: string | null
          advertiser: string | null
          alert_severity_threshold: string | null
          algorithm_code: string
          attribution_model: string | null
          brand: string | null
          campaign_id: string
          config: Json
          created_at: string
          created_by: string | null
          currency: string
          daily_budget_max: number | null
          description: string | null
          dsp_external_id: string | null
          end_date: string | null
          execution_mode: string
          forecast_cpm: number | null
          frequency_cap_imps: number | null
          frequency_cap_period_days: number | null
          granularity: string
          id: string
          in_zone_weights: Json
          init_preset_code: string | null
          internal_reference: string | null
          inventory_type: string | null
          is_demo: boolean
          kpi_secondary: string[]
          kpi_target: number | null
          name: string
          notification_channels: string[]
          objective_code: string
          out_zone_weights: Json
          pacing_strategy: string | null
          scope_type: string
          start_date: string | null
          status: string
          status_changed_at: string | null
          total_budget: number | null
          updated_at: string
          weighting_mode: string
          zone_id: string | null
        }
        Insert: {
          activated_at?: string | null
          advertiser?: string | null
          alert_severity_threshold?: string | null
          algorithm_code: string
          attribution_model?: string | null
          brand?: string | null
          campaign_id: string
          config?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          daily_budget_max?: number | null
          description?: string | null
          dsp_external_id?: string | null
          end_date?: string | null
          execution_mode?: string
          forecast_cpm?: number | null
          frequency_cap_imps?: number | null
          frequency_cap_period_days?: number | null
          granularity?: string
          id?: string
          in_zone_weights?: Json
          init_preset_code?: string | null
          internal_reference?: string | null
          inventory_type?: string | null
          is_demo?: boolean
          kpi_secondary?: string[]
          kpi_target?: number | null
          name: string
          notification_channels?: string[]
          objective_code: string
          out_zone_weights?: Json
          pacing_strategy?: string | null
          scope_type?: string
          start_date?: string | null
          status?: string
          status_changed_at?: string | null
          total_budget?: number | null
          updated_at?: string
          weighting_mode?: string
          zone_id?: string | null
        }
        Update: {
          activated_at?: string | null
          advertiser?: string | null
          alert_severity_threshold?: string | null
          algorithm_code?: string
          attribution_model?: string | null
          brand?: string | null
          campaign_id?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          daily_budget_max?: number | null
          description?: string | null
          dsp_external_id?: string | null
          end_date?: string | null
          execution_mode?: string
          forecast_cpm?: number | null
          frequency_cap_imps?: number | null
          frequency_cap_period_days?: number | null
          granularity?: string
          id?: string
          in_zone_weights?: Json
          init_preset_code?: string | null
          internal_reference?: string | null
          inventory_type?: string | null
          is_demo?: boolean
          kpi_secondary?: string[]
          kpi_target?: number | null
          name?: string
          notification_channels?: string[]
          objective_code?: string
          out_zone_weights?: Json
          pacing_strategy?: string | null
          scope_type?: string
          start_date?: string | null
          status?: string
          status_changed_at?: string | null
          total_budget?: number | null
          updated_at?: string
          weighting_mode?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bidding_strategies_algorithm_code_fkey"
            columns: ["algorithm_code"]
            isOneToOne: false
            referencedRelation: "bidding_algorithms"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "bidding_strategies_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dsp_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bidding_strategies_objective_code_fkey"
            columns: ["objective_code"]
            isOneToOne: false
            referencedRelation: "bidding_objectives"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "bidding_strategies_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "custom_geo_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      bidding_strategy_drafts: {
        Row: {
          campaign_id: string
          consumed_at: string | null
          created_at: string
          current_step: number
          draft_data: Json
          expires_at: string | null
          id: string
          last_saved_at: string
          resulting_strategy_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          consumed_at?: string | null
          created_at?: string
          current_step?: number
          draft_data?: Json
          expires_at?: string | null
          id?: string
          last_saved_at?: string
          resulting_strategy_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          consumed_at?: string | null
          created_at?: string
          current_step?: number
          draft_data?: Json
          expires_at?: string | null
          id?: string
          last_saved_at?: string
          resulting_strategy_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bidding_strategy_drafts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dsp_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bidding_strategy_drafts_resulting_strategy_id_fkey"
            columns: ["resulting_strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      bidding_strategy_subzones: {
        Row: {
          created_at: string
          display_order: number
          id: string
          multiplier: number
          name: string
          postal_codes: string[]
          strategy_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          multiplier: number
          name: string
          postal_codes: string[]
          strategy_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          multiplier?: number
          name?: string
          postal_codes?: string[]
          strategy_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bidding_strategy_subzones_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      bidding_zone_configs: {
        Row: {
          bid_multiplier: number
          ceiling_bid: number | null
          constraints: Json
          country_code: string
          created_at: string
          floor_bid: number | null
          id: string
          is_active: boolean
          postal_code: string
          strategy_id: string
          target_metrics: Json
          updated_at: string
          weight: number
        }
        Insert: {
          bid_multiplier?: number
          ceiling_bid?: number | null
          constraints?: Json
          country_code?: string
          created_at?: string
          floor_bid?: number | null
          id?: string
          is_active?: boolean
          postal_code: string
          strategy_id: string
          target_metrics?: Json
          updated_at?: string
          weight?: number
        }
        Update: {
          bid_multiplier?: number
          ceiling_bid?: number | null
          constraints?: Json
          country_code?: string
          created_at?: string
          floor_bid?: number | null
          id?: string
          is_active?: boolean
          postal_code?: string
          strategy_id?: string
          target_metrics?: Json
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "bidding_zone_configs_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_cp_rollup: {
        Row: {
          actor: string
          campaign_id: string
          clicks: number
          dept: string | null
          impressions: number
          imps_7d: number
          imps_prev7d: number
          in_target: boolean
          planned_share: number | null
          postal_code: string
          spend: number
        }
        Insert: {
          actor?: string
          campaign_id: string
          clicks?: number
          dept?: string | null
          impressions?: number
          imps_7d?: number
          imps_prev7d?: number
          in_target?: boolean
          planned_share?: number | null
          postal_code: string
          spend?: number
        }
        Update: {
          actor?: string
          campaign_id?: string
          clicks?: number
          dept?: string | null
          impressions?: number
          imps_7d?: number
          imps_prev7d?: number
          in_target?: boolean
          planned_share?: number | null
          postal_code?: string
          spend?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_cp_rollup_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dsp_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_daily_rollup: {
        Row: {
          actor: string
          campaign_id: string
          clicks: number
          date: string
          impressions: number
          media: string
          spend: number
        }
        Insert: {
          actor?: string
          campaign_id: string
          clicks?: number
          date: string
          impressions?: number
          media?: string
          spend?: number
        }
        Update: {
          actor?: string
          campaign_id?: string
          clicks?: number
          date?: string
          impressions?: number
          media?: string
          spend?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_daily_rollup_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dsp_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_dsp_report: {
        Row: {
          campaign_id: string
          channel: string
          clicks: number
          creative_ref: string | null
          date: string | null
          format: string | null
          impressions: number
          postal_code: string
          pulled_at: string
          source: string
          spend: number
        }
        Insert: {
          campaign_id: string
          channel?: string
          clicks?: number
          creative_ref?: string | null
          date?: string | null
          format?: string | null
          impressions?: number
          postal_code?: string
          pulled_at?: string
          source?: string
          spend?: number
        }
        Update: {
          campaign_id?: string
          channel?: string
          clicks?: number
          creative_ref?: string | null
          date?: string | null
          format?: string | null
          impressions?: number
          postal_code?: string
          pulled_at?: string
          source?: string
          spend?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_dsp_report_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dsp_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_organizations: {
        Row: {
          added_at: string | null
          added_by: string | null
          campaign_id: string
          id: string
          organization_id: string
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          campaign_id: string
          id?: string
          organization_id: string
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          campaign_id?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_organizations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dsp_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_snapshot: {
        Row: {
          budget: number | null
          campaign_id: string
          cible: string | null
          cpm: number | null
          created_at: string
          created_by: string | null
          dsp: string | null
          expected_share: number
          id: string
          item_id: string
          item_name: string | null
          item_weight: number
          period_end: string | null
          period_start: string | null
          postal_code: string
          version: number
          zone_id: string
          zone_name: string | null
        }
        Insert: {
          budget?: number | null
          campaign_id: string
          cible?: string | null
          cpm?: number | null
          created_at?: string
          created_by?: string | null
          dsp?: string | null
          expected_share: number
          id?: string
          item_id: string
          item_name?: string | null
          item_weight: number
          period_end?: string | null
          period_start?: string | null
          postal_code: string
          version: number
          zone_id: string
          zone_name?: string | null
        }
        Update: {
          budget?: number | null
          campaign_id?: string
          cible?: string | null
          cpm?: number | null
          created_at?: string
          created_by?: string | null
          dsp?: string | null
          expected_share?: number
          id?: string
          item_id?: string
          item_name?: string | null
          item_weight?: number
          period_end?: string | null
          period_start?: string | null
          postal_code?: string
          version?: number
          zone_id?: string
          zone_name?: string | null
        }
        Relationships: []
      }
      carreau_risque_bandes: {
        Row: {
          bande: number
          construit_le: string
          duree_ms: number
          lon_max: number
          lon_min: number
          n_lignes: number
        }
        Insert: {
          bande: number
          construit_le?: string
          duree_ms: number
          lon_max: number
          lon_min: number
          n_lignes: number
        }
        Update: {
          bande?: number
          construit_le?: string
          duree_ms?: number
          lon_max?: number
          lon_min?: number
          n_lignes?: number
        }
        Relationships: []
      }
      carreau_risque_distance: {
        Row: {
          carreau_id: number
          code_commune: string | null
          code_departement: string
          code_postal: string | null
          d_bas_m: number | null
          d_haut_m: number | null
          pprt_niveau: string | null
        }
        Insert: {
          carreau_id: number
          code_commune?: string | null
          code_departement: string
          code_postal?: string | null
          d_bas_m?: number | null
          d_haut_m?: number | null
          pprt_niveau?: string | null
        }
        Update: {
          carreau_id?: number
          code_commune?: string | null
          code_departement?: string
          code_postal?: string | null
          d_bas_m?: number | null
          d_haut_m?: number | null
          pprt_niveau?: string | null
        }
        Relationships: []
      }
      carreaux_1km: {
        Row: {
          familles_monoparentales: number
          geom_3857: unknown
          grid_id: string
          ind_0_3: number
          ind_11_17: number
          ind_18_24: number
          ind_25_39: number
          ind_4_5: number
          ind_40_54: number
          ind_55_64: number
          ind_6_10: number
          ind_65_79: number
          ind_80p: number
          logements_1945_1970: number
          logements_1970_1990: number
          logements_apres_1990: number
          logements_avant_1945: number
          logements_inconnus: number
          logements_sociaux: number
          menages_1_personne: number
          menages_5_plus: number
          menages_collectif: number
          menages_maison: number
          menages_pauvres: number
          menages_proprietaires: number
          menages_total: number
          nb_carreaux: number
          population_inconnue: number
          population_totale: number
          revenu_median: number
          surface_moyenne: number
        }
        Insert: {
          familles_monoparentales?: number
          geom_3857: unknown
          grid_id: string
          ind_0_3?: number
          ind_11_17?: number
          ind_18_24?: number
          ind_25_39?: number
          ind_4_5?: number
          ind_40_54?: number
          ind_55_64?: number
          ind_6_10?: number
          ind_65_79?: number
          ind_80p?: number
          logements_1945_1970?: number
          logements_1970_1990?: number
          logements_apres_1990?: number
          logements_avant_1945?: number
          logements_inconnus?: number
          logements_sociaux?: number
          menages_1_personne?: number
          menages_5_plus?: number
          menages_collectif?: number
          menages_maison?: number
          menages_pauvres?: number
          menages_proprietaires?: number
          menages_total?: number
          nb_carreaux: number
          population_inconnue?: number
          population_totale?: number
          revenu_median?: number
          surface_moyenne?: number
        }
        Update: {
          familles_monoparentales?: number
          geom_3857?: unknown
          grid_id?: string
          ind_0_3?: number
          ind_11_17?: number
          ind_18_24?: number
          ind_25_39?: number
          ind_4_5?: number
          ind_40_54?: number
          ind_55_64?: number
          ind_6_10?: number
          ind_65_79?: number
          ind_80p?: number
          logements_1945_1970?: number
          logements_1970_1990?: number
          logements_apres_1990?: number
          logements_avant_1945?: number
          logements_inconnus?: number
          logements_sociaux?: number
          menages_1_personne?: number
          menages_5_plus?: number
          menages_collectif?: number
          menages_maison?: number
          menages_pauvres?: number
          menages_proprietaires?: number
          menages_total?: number
          nb_carreaux?: number
          population_inconnue?: number
          population_totale?: number
          revenu_median?: number
          surface_moyenne?: number
        }
        Relationships: []
      }
      carreaux_1km_bandes: {
        Row: {
          faite_le: string
          mailles: number
          ms: number
          sources: number
          x0: number
          x1: number
        }
        Insert: {
          faite_le?: string
          mailles: number
          ms: number
          sources: number
          x0: number
          x1: number
        }
        Update: {
          faite_le?: string
          mailles?: number
          ms?: number
          sources?: number
          x0?: number
          x1?: number
        }
        Relationships: []
      }
      carreaux_2km: {
        Row: {
          geom: unknown
          id: string
          ind: number | null
          ind_0_3: number | null
          ind_11_17: number | null
          ind_18_24: number | null
          ind_25_39: number | null
          ind_4_5: number | null
          ind_40_54: number | null
          ind_55_64: number | null
          ind_6_10: number | null
          ind_65_79: number | null
          ind_80p: number | null
          ind_inc: number | null
          ind_snv: number | null
          log_45_70: number | null
          log_70_90: number | null
          log_ap90: number | null
          log_av45: number | null
          log_inc: number | null
          log_soc: number | null
          men: number | null
          men_1ind: number | null
          men_5ind: number | null
          men_coll: number | null
          men_fmp: number | null
          men_mais: number | null
          men_pauv: number | null
          men_prop: number | null
          men_surf: number | null
        }
        Insert: {
          geom: unknown
          id: string
          ind?: number | null
          ind_0_3?: number | null
          ind_11_17?: number | null
          ind_18_24?: number | null
          ind_25_39?: number | null
          ind_4_5?: number | null
          ind_40_54?: number | null
          ind_55_64?: number | null
          ind_6_10?: number | null
          ind_65_79?: number | null
          ind_80p?: number | null
          ind_inc?: number | null
          ind_snv?: number | null
          log_45_70?: number | null
          log_70_90?: number | null
          log_ap90?: number | null
          log_av45?: number | null
          log_inc?: number | null
          log_soc?: number | null
          men?: number | null
          men_1ind?: number | null
          men_5ind?: number | null
          men_coll?: number | null
          men_fmp?: number | null
          men_mais?: number | null
          men_pauv?: number | null
          men_prop?: number | null
          men_surf?: number | null
        }
        Update: {
          geom?: unknown
          id?: string
          ind?: number | null
          ind_0_3?: number | null
          ind_11_17?: number | null
          ind_18_24?: number | null
          ind_25_39?: number | null
          ind_4_5?: number | null
          ind_40_54?: number | null
          ind_55_64?: number | null
          ind_6_10?: number | null
          ind_65_79?: number | null
          ind_80p?: number | null
          ind_inc?: number | null
          ind_snv?: number | null
          log_45_70?: number | null
          log_70_90?: number | null
          log_ap90?: number | null
          log_av45?: number | null
          log_inc?: number | null
          log_soc?: number | null
          men?: number | null
          men_1ind?: number | null
          men_5ind?: number | null
          men_coll?: number | null
          men_fmp?: number | null
          men_mais?: number | null
          men_pauv?: number | null
          men_prop?: number | null
          men_surf?: number | null
        }
        Relationships: []
      }
      carreaux_5km: {
        Row: {
          geom: unknown
          id: string
          ind: number | null
          ind_0_3: number | null
          ind_11_17: number | null
          ind_18_24: number | null
          ind_25_39: number | null
          ind_4_5: number | null
          ind_40_54: number | null
          ind_55_64: number | null
          ind_6_10: number | null
          ind_65_79: number | null
          ind_80p: number | null
          ind_inc: number | null
          ind_snv: number | null
          log_45_70: number | null
          log_70_90: number | null
          log_ap90: number | null
          log_av45: number | null
          log_inc: number | null
          log_soc: number | null
          men: number | null
          men_1ind: number | null
          men_5ind: number | null
          men_coll: number | null
          men_fmp: number | null
          men_mais: number | null
          men_pauv: number | null
          men_prop: number | null
          men_surf: number | null
        }
        Insert: {
          geom: unknown
          id: string
          ind?: number | null
          ind_0_3?: number | null
          ind_11_17?: number | null
          ind_18_24?: number | null
          ind_25_39?: number | null
          ind_4_5?: number | null
          ind_40_54?: number | null
          ind_55_64?: number | null
          ind_6_10?: number | null
          ind_65_79?: number | null
          ind_80p?: number | null
          ind_inc?: number | null
          ind_snv?: number | null
          log_45_70?: number | null
          log_70_90?: number | null
          log_ap90?: number | null
          log_av45?: number | null
          log_inc?: number | null
          log_soc?: number | null
          men?: number | null
          men_1ind?: number | null
          men_5ind?: number | null
          men_coll?: number | null
          men_fmp?: number | null
          men_mais?: number | null
          men_pauv?: number | null
          men_prop?: number | null
          men_surf?: number | null
        }
        Update: {
          geom?: unknown
          id?: string
          ind?: number | null
          ind_0_3?: number | null
          ind_11_17?: number | null
          ind_18_24?: number | null
          ind_25_39?: number | null
          ind_4_5?: number | null
          ind_40_54?: number | null
          ind_55_64?: number | null
          ind_6_10?: number | null
          ind_65_79?: number | null
          ind_80p?: number | null
          ind_inc?: number | null
          ind_snv?: number | null
          log_45_70?: number | null
          log_70_90?: number | null
          log_ap90?: number | null
          log_av45?: number | null
          log_inc?: number | null
          log_soc?: number | null
          men?: number | null
          men_1ind?: number | null
          men_5ind?: number | null
          men_coll?: number | null
          men_fmp?: number | null
          men_mais?: number | null
          men_pauv?: number | null
          men_prop?: number | null
          men_surf?: number | null
        }
        Relationships: []
      }
      carreaux_cp_population: {
        Row: {
          code_postal: string
          pop_total: number
        }
        Insert: {
          code_postal: string
          pop_total: number
        }
        Update: {
          code_postal?: string
          pop_total?: number
        }
        Relationships: []
      }
      carreaux_filosofi: {
        Row: {
          created_at: string | null
          geom: unknown
          geom_3857: unknown
          geom_centroid: unknown
          id: number
          idcar: string
          ind: number | null
          ind_18_24: number | null
          ind_25_39: number | null
          ind_40_54: number | null
          ind_inc: number | null
          metadata: Json | null
          millesime: string
          resolution: string
        }
        Insert: {
          created_at?: string | null
          geom?: unknown
          geom_3857?: unknown
          geom_centroid?: unknown
          id?: number
          idcar: string
          ind?: number | null
          ind_18_24?: number | null
          ind_25_39?: number | null
          ind_40_54?: number | null
          ind_inc?: number | null
          metadata?: Json | null
          millesime?: string
          resolution?: string
        }
        Update: {
          created_at?: string | null
          geom?: unknown
          geom_3857?: unknown
          geom_centroid?: unknown
          id?: number
          idcar?: string
          ind?: number | null
          ind_18_24?: number | null
          ind_25_39?: number | null
          ind_40_54?: number | null
          ind_inc?: number | null
          metadata?: Json | null
          millesime?: string
          resolution?: string
        }
        Relationships: []
      }
      cible_indicator_registry: {
        Row: {
          active: boolean
          created_at: string
          data_column: string
          data_source: string
          default_operator: string
          dynamic: boolean
          famille: string
          indicator_code: string
          label: string
          normalize: string
          scale: string
          slider_max: number
          slider_min: number
          slider_step: number
          unit: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          data_column: string
          data_source: string
          default_operator?: string
          dynamic?: boolean
          famille: string
          indicator_code: string
          label: string
          normalize?: string
          scale: string
          slider_max: number
          slider_min: number
          slider_step?: number
          unit: string
        }
        Update: {
          active?: boolean
          created_at?: string
          data_column?: string
          data_source?: string
          default_operator?: string
          dynamic?: boolean
          famille?: string
          indicator_code?: string
          label?: string
          normalize?: string
          scale?: string
          slider_max?: number
          slider_min?: number
          slider_step?: number
          unit?: string
        }
        Relationships: []
      }
      cibles_exposition: {
        Row: {
          actif: boolean
          code: string
          famille: string
          libelle: string
          ordre: number
        }
        Insert: {
          actif?: boolean
          code: string
          famille: string
          libelle: string
          ordre: number
        }
        Update: {
          actif?: boolean
          code?: string
          famille?: string
          libelle?: string
          ordre?: number
        }
        Relationships: []
      }
      civic_health_cache: {
        Row: {
          code_insee: string
          fetched_at: string
          payload: Json
          provider: string
        }
        Insert: {
          code_insee: string
          fetched_at?: string
          payload: Json
          provider?: string
        }
        Update: {
          code_insee?: string
          fetched_at?: string
          payload?: Json
          provider?: string
        }
        Relationships: []
      }
      clustering_jobs: {
        Row: {
          error: string | null
          finished_at: string | null
          geo_filter: Json | null
          id: string
          log_tail: string | null
          params: Json | null
          poi_types: string[]
          result_meta: Json | null
          started_at: string
          status: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          geo_filter?: Json | null
          id?: string
          log_tail?: string | null
          params?: Json | null
          poi_types: string[]
          result_meta?: Json | null
          started_at?: string
          status?: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          geo_filter?: Json | null
          id?: string
          log_tail?: string | null
          params?: Json | null
          poi_types?: string[]
          result_meta?: Json | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      clustering_models: {
        Row: {
          analysis: Json | null
          centroids: Json
          cluster_avg_profiles: Json
          cluster_labels: Json
          cluster_mapping_from_previous: Json | null
          created_at: string | null
          duration_minutes: number
          feature_names: Json
          feature_themes: Json | null
          id: number
          k: number
          mode: string
          n_pca_components: number | null
          n_poi_trained: number | null
          pca_components: Json
          pca_mean: Json
          profil_palier: string | null
          scaler_mean: Json
          scaler_scale: Json
          silhouette_score: number | null
          variance_explained: number | null
          version: number
        }
        Insert: {
          analysis?: Json | null
          centroids: Json
          cluster_avg_profiles: Json
          cluster_labels: Json
          cluster_mapping_from_previous?: Json | null
          created_at?: string | null
          duration_minutes?: number
          feature_names: Json
          feature_themes?: Json | null
          id?: number
          k: number
          mode?: string
          n_pca_components?: number | null
          n_poi_trained?: number | null
          pca_components: Json
          pca_mean: Json
          profil_palier?: string | null
          scaler_mean: Json
          scaler_scale: Json
          silhouette_score?: number | null
          variance_explained?: number | null
          version: number
        }
        Update: {
          analysis?: Json | null
          centroids?: Json
          cluster_avg_profiles?: Json
          cluster_labels?: Json
          cluster_mapping_from_previous?: Json | null
          created_at?: string | null
          duration_minutes?: number
          feature_names?: Json
          feature_themes?: Json | null
          id?: number
          k?: number
          mode?: string
          n_pca_components?: number | null
          n_poi_trained?: number | null
          pca_components?: Json
          pca_mean?: Json
          profil_palier?: string | null
          scaler_mean?: Json
          scaler_scale?: Json
          silhouette_score?: number | null
          variance_explained?: number | null
          version?: number
        }
        Relationships: []
      }
      communes_arrondissements: {
        Row: {
          code_arrondissement: string
          code_commune_mere: string
          nom_commune_mere: string
        }
        Insert: {
          code_arrondissement: string
          code_commune_mere: string
          nom_commune_mere: string
        }
        Update: {
          code_arrondissement?: string
          code_commune_mere?: string
          nom_commune_mere?: string
        }
        Relationships: []
      }
      comptages_routiers: {
        Row: {
          annee_mesure: number | null
          created_at: string | null
          departement: string | null
          geom: unknown
          geom_3857: unknown
          geom_midpoint: unknown
          id: number
          longueur_m: number | null
          metadata: Json | null
          osm_id: number | null
          ratio_pl: number | null
          route: string | null
          source: string | null
          tmja: number | null
          tmja_tier: number
          type_comptage: string | null
        }
        Insert: {
          annee_mesure?: number | null
          created_at?: string | null
          departement?: string | null
          geom?: unknown
          geom_3857?: unknown
          geom_midpoint?: unknown
          id?: number
          longueur_m?: number | null
          metadata?: Json | null
          osm_id?: number | null
          ratio_pl?: number | null
          route?: string | null
          source?: string | null
          tmja?: number | null
          tmja_tier: number
          type_comptage?: string | null
        }
        Update: {
          annee_mesure?: number | null
          created_at?: string | null
          departement?: string | null
          geom?: unknown
          geom_3857?: unknown
          geom_midpoint?: unknown
          id?: number
          longueur_m?: number | null
          metadata?: Json | null
          osm_id?: number | null
          ratio_pl?: number | null
          route?: string | null
          source?: string | null
          tmja?: number | null
          tmja_tier?: number
          type_comptage?: string | null
        }
        Relationships: []
      }
      couverture_rayon_bandes: {
        Row: {
          bande: number
          construit_le: string
          duree_ms: number
          lon_max: number
          lon_min: number
          n_lignes: number
        }
        Insert: {
          bande: number
          construit_le?: string
          duree_ms: number
          lon_max: number
          lon_min: number
          n_lignes: number
        }
        Update: {
          bande?: number
          construit_le?: string
          duree_ms?: number
          lon_max?: number
          lon_min?: number
          n_lignes?: number
        }
        Relationships: []
      }
      couverture_rayon_risque: {
        Row: {
          code_departement: string
          gravite: string
          n_carreaux: number
          nature: string
          populations: Json
          rayon_m: number
        }
        Insert: {
          code_departement: string
          gravite: string
          n_carreaux: number
          nature: string
          populations: Json
          rayon_m: number
        }
        Update: {
          code_departement?: string
          gravite?: string
          n_carreaux?: number
          nature?: string
          populations?: Json
          rayon_m?: number
        }
        Relationships: []
      }
      cp_population_totale: {
        Row: {
          code_postal: string
          construit_le: string
          n_carreaux: number
          populations: Json
        }
        Insert: {
          code_postal: string
          construit_le?: string
          n_carreaux: number
          populations: Json
        }
        Update: {
          code_postal?: string
          construit_le?: string
          n_carreaux?: number
          populations?: Json
        }
        Relationships: []
      }
      custom_geo_zone_codes: {
        Row: {
          code: string
          code_type: string
          subzone_id: string | null
          zone_id: string
        }
        Insert: {
          code: string
          code_type: string
          subzone_id?: string | null
          zone_id: string
        }
        Update: {
          code?: string
          code_type?: string
          subzone_id?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_geo_zone_codes_subzone_id_fkey"
            columns: ["subzone_id"]
            isOneToOne: false
            referencedRelation: "custom_geo_zone_subzones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_geo_zone_codes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "custom_geo_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_geo_zone_subzones: {
        Row: {
          created_at: string
          default_multiplier: number
          geometry: unknown
          id: string
          name: string
          ordering: number
          source_ref: string | null
          zone_id: string
        }
        Insert: {
          created_at?: string
          default_multiplier?: number
          geometry: unknown
          id?: string
          name: string
          ordering?: number
          source_ref?: string | null
          zone_id: string
        }
        Update: {
          created_at?: string
          default_multiplier?: number
          geometry?: unknown
          id?: string
          name?: string
          ordering?: number
          source_ref?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_geo_zone_subzones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "custom_geo_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_geo_zones: {
        Row: {
          audience_computed_at: string | null
          audience_stats: Json
          bbox: unknown
          created_at: string
          created_by: string | null
          description: string | null
          feature_count_cp: number
          feature_count_iris: number
          geometry: unknown
          id: string
          items_audience_computed_at: string | null
          items_audience_stats: Json | null
          name: string
          org_id: string
          resolved_at: string | null
          source_metadata: Json
          source_type: string
          updated_at: string
        }
        Insert: {
          audience_computed_at?: string | null
          audience_stats?: Json
          bbox?: unknown
          created_at?: string
          created_by?: string | null
          description?: string | null
          feature_count_cp?: number
          feature_count_iris?: number
          geometry: unknown
          id?: string
          items_audience_computed_at?: string | null
          items_audience_stats?: Json | null
          name: string
          org_id: string
          resolved_at?: string | null
          source_metadata?: Json
          source_type: string
          updated_at?: string
        }
        Update: {
          audience_computed_at?: string | null
          audience_stats?: Json
          bbox?: unknown
          created_at?: string
          created_by?: string | null
          description?: string | null
          feature_count_cp?: number
          feature_count_iris?: number
          geometry?: unknown
          id?: string
          items_audience_computed_at?: string | null
          items_audience_stats?: Json | null
          name?: string
          org_id?: string
          resolved_at?: string | null
          source_metadata?: Json
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_geo_zones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_registry: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: number
          is_active: boolean
          label: string
          metadata: Json
          slug: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: number
          is_active?: boolean
          label: string
          metadata?: Json
          slug: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: number
          is_active?: boolean
          label?: string
          metadata?: Json
          slug?: string
        }
        Relationships: []
      }
      data_sources: {
        Row: {
          ai_summary: string | null
          category: string | null
          description: string | null
          error_count: number | null
          file_format: string | null
          filter_fields: string[] | null
          geo_config: Json | null
          id: string
          import_date: string | null
          imported_by: string | null
          mapping: Json | null
          metadata: Json | null
          name: string
          organization_id: string | null
          original_filename: string | null
          regie: string | null
          row_count: number | null
          shared_with: string[] | null
          status: string | null
          type: string
          valid_count: number | null
        }
        Insert: {
          ai_summary?: string | null
          category?: string | null
          description?: string | null
          error_count?: number | null
          file_format?: string | null
          filter_fields?: string[] | null
          geo_config?: Json | null
          id?: string
          import_date?: string | null
          imported_by?: string | null
          mapping?: Json | null
          metadata?: Json | null
          name: string
          organization_id?: string | null
          original_filename?: string | null
          regie?: string | null
          row_count?: number | null
          shared_with?: string[] | null
          status?: string | null
          type: string
          valid_count?: number | null
        }
        Update: {
          ai_summary?: string | null
          category?: string | null
          description?: string | null
          error_count?: number | null
          file_format?: string | null
          filter_fields?: string[] | null
          geo_config?: Json | null
          id?: string
          import_date?: string | null
          imported_by?: string | null
          mapping?: Json | null
          metadata?: Json | null
          name?: string
          organization_id?: string | null
          original_filename?: string | null
          regie?: string | null
          row_count?: number | null
          shared_with?: string[] | null
          status?: string | null
          type?: string
          valid_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "data_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dataset_abstention_2022: {
        Row: {
          abstentions: number
          code_dept: string | null
          code_postal: string
          imported_at: string
          inscrits: number
          nb_communes: number
          taux_abstention: number
        }
        Insert: {
          abstentions: number
          code_dept?: string | null
          code_postal: string
          imported_at?: string
          inscrits: number
          nb_communes?: number
          taux_abstention: number
        }
        Update: {
          abstentions?: number
          code_dept?: string | null
          code_postal?: string
          imported_at?: string
          inscrits?: number
          nb_communes?: number
          taux_abstention?: number
        }
        Relationships: []
      }
      dsp_api_logs: {
        Row: {
          action: string
          category: string
          created_at: string
          detail: Json
          duration_ms: number | null
          id: string
          level: string
          message: string | null
          organization_id: string
          provider: string
          status_code: number | null
        }
        Insert: {
          action: string
          category: string
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          id?: string
          level?: string
          message?: string | null
          organization_id: string
          provider: string
          status_code?: number | null
        }
        Update: {
          action?: string
          category?: string
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          id?: string
          level?: string
          message?: string | null
          organization_id?: string
          provider?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dsp_api_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dsp_campaign_data: {
        Row: {
          actor: string | null
          campaign_id: string | null
          city: string | null
          clicks: number | null
          code_commune: string | null
          code_iris: string | null
          country: string
          date: string | null
          dma_region: string | null
          dsp_source: string | null
          id: string
          impressions: number | null
          matched_at: string | null
          media: string | null
          metrics: Json
          postal_code: string | null
          region: string | null
          spend: number | null
          tracked_ads: number
          unique_impressions: number | null
        }
        Insert: {
          actor?: string | null
          campaign_id?: string | null
          city?: string | null
          clicks?: number | null
          code_commune?: string | null
          code_iris?: string | null
          country: string
          date?: string | null
          dma_region?: string | null
          dsp_source?: string | null
          id?: string
          impressions?: number | null
          matched_at?: string | null
          media?: string | null
          metrics?: Json
          postal_code?: string | null
          region?: string | null
          spend?: number | null
          tracked_ads?: number
          unique_impressions?: number | null
        }
        Update: {
          actor?: string | null
          campaign_id?: string | null
          city?: string | null
          clicks?: number | null
          code_commune?: string | null
          code_iris?: string | null
          country?: string
          date?: string | null
          dma_region?: string | null
          dsp_source?: string | null
          id?: string
          impressions?: number | null
          matched_at?: string | null
          media?: string | null
          metrics?: Json
          postal_code?: string | null
          region?: string | null
          spend?: number | null
          tracked_ads?: number
          unique_impressions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dsp_campaign_data_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dsp_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      dsp_campaigns: {
        Row: {
          advertiser: string | null
          countries: string[] | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          date_end: string | null
          date_start: string | null
          dsp_source: string
          geo_strategy: Json
          id: string
          is_demo: boolean
          kpi_primary: string | null
          kpi_target: number | null
          name: string
          organization_id: string | null
          overpressure_weight: number
          product: string | null
          status_override: string | null
          status_override_at: string | null
          status_override_by: string | null
          tolerance_pct: number
          total_budget: number | null
          total_tracked_ads: number | null
          total_unique_impressions: number
        }
        Insert: {
          advertiser?: string | null
          countries?: string[] | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          date_end?: string | null
          date_start?: string | null
          dsp_source?: string
          geo_strategy?: Json
          id?: string
          is_demo?: boolean
          kpi_primary?: string | null
          kpi_target?: number | null
          name: string
          organization_id?: string | null
          overpressure_weight?: number
          product?: string | null
          status_override?: string | null
          status_override_at?: string | null
          status_override_by?: string | null
          tolerance_pct?: number
          total_budget?: number | null
          total_tracked_ads?: number | null
          total_unique_impressions?: number
        }
        Update: {
          advertiser?: string | null
          countries?: string[] | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          date_end?: string | null
          date_start?: string | null
          dsp_source?: string
          geo_strategy?: Json
          id?: string
          is_demo?: boolean
          kpi_primary?: string | null
          kpi_target?: number | null
          name?: string
          organization_id?: string | null
          overpressure_weight?: number
          product?: string | null
          status_override?: string | null
          status_override_at?: string | null
          status_override_by?: string | null
          tolerance_pct?: number
          total_budget?: number | null
          total_tracked_ads?: number | null
          total_unique_impressions?: number
        }
        Relationships: [
          {
            foreignKeyName: "dsp_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dsp_channel_registry: {
        Row: {
          active: boolean
          category: string
          code: string
          connection_provider: string | null
          created_at: string
          label: string
          link_levels: Json
        }
        Insert: {
          active?: boolean
          category: string
          code: string
          connection_provider?: string | null
          created_at?: string
          label: string
          link_levels?: Json
        }
        Update: {
          active?: boolean
          category?: string
          code?: string
          connection_provider?: string | null
          created_at?: string
          label?: string
          link_levels?: Json
        }
        Relationships: []
      }
      dsp_connections: {
        Row: {
          advertiser_ids: Json
          auth_method: string | null
          created_at: string
          created_by: string | null
          credentials_encrypted: string | null
          id: string
          last_error: string | null
          meta: Json
          oauth_client_id: string | null
          oauth_client_secret_encrypted: string | null
          oauth_refresh_token_encrypted: string | null
          organization_id: string
          partner_id: string | null
          provider: string
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          advertiser_ids?: Json
          auth_method?: string | null
          created_at?: string
          created_by?: string | null
          credentials_encrypted?: string | null
          id?: string
          last_error?: string | null
          meta?: Json
          oauth_client_id?: string | null
          oauth_client_secret_encrypted?: string | null
          oauth_refresh_token_encrypted?: string | null
          organization_id: string
          partner_id?: string | null
          provider: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          advertiser_ids?: Json
          auth_method?: string | null
          created_at?: string
          created_by?: string | null
          credentials_encrypted?: string | null
          id?: string
          last_error?: string | null
          meta?: Json
          oauth_client_id?: string | null
          oauth_client_secret_encrypted?: string | null
          oauth_refresh_token_encrypted?: string | null
          organization_id?: string
          partner_id?: string | null
          provider?: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dsp_connections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dsp_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dsp_metrics_registry: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          display_name_fr: string | null
          display_order: number
          field: string
          is_core: boolean
          is_enabled: boolean
          is_kpi_eligible: boolean
          is_legacy: boolean
          optimization_direction: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          display_name_fr?: string | null
          display_order?: number
          field: string
          is_core?: boolean
          is_enabled?: boolean
          is_kpi_eligible?: boolean
          is_legacy?: boolean
          optimization_direction?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          display_name_fr?: string | null
          display_order?: number
          field?: string
          is_core?: boolean
          is_enabled?: boolean
          is_kpi_eligible?: boolean
          is_legacy?: boolean
          optimization_direction?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dsp_source_mappings: {
        Row: {
          created_at: string
          data_type: string
          display_order: number
          dsp_source: string
          id: string
          is_required: boolean
          notes: string | null
          source_column: string
          target_field: string
          target_location: string
          transform: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_type: string
          display_order?: number
          dsp_source: string
          id?: string
          is_required?: boolean
          notes?: string | null
          source_column: string
          target_field: string
          target_location: string
          transform?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_type?: string
          display_order?: number
          dsp_source?: string
          id?: string
          is_required?: boolean
          notes?: string | null
          source_column?: string
          target_field?: string
          target_location?: string
          transform?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      emetteur_radio_stations: {
        Row: {
          created_at: string | null
          emetteur_id: string
          id: string
          radio_id: string
          source: string
        }
        Insert: {
          created_at?: string | null
          emetteur_id: string
          id?: string
          radio_id: string
          source: string
        }
        Update: {
          created_at?: string | null
          emetteur_id?: string
          id?: string
          radio_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "emetteur_radio_stations_emetteur_id_fkey"
            columns: ["emetteur_id"]
            isOneToOne: false
            referencedRelation: "emetteurs_radio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emetteur_radio_stations_radio_id_fkey"
            columns: ["radio_id"]
            isOneToOne: false
            referencedRelation: "radios"
            referencedColumns: ["id"]
          },
        ]
      }
      emetteurs_radio: {
        Row: {
          adresse: string | null
          commune: string | null
          created_at: string | null
          departement: string | null
          exploitant: string | null
          frequence_mhz: number | null
          geom: unknown
          hauteur_m: number | null
          id: string
          puissance_w: number | null
          radio_id: string | null
          rayon_couverture_m: number | null
          snapshot_date: string
          sta_nm_anfr: string
          systeme: string
        }
        Insert: {
          adresse?: string | null
          commune?: string | null
          created_at?: string | null
          departement?: string | null
          exploitant?: string | null
          frequence_mhz?: number | null
          geom?: unknown
          hauteur_m?: number | null
          id?: string
          puissance_w?: number | null
          radio_id?: string | null
          rayon_couverture_m?: number | null
          snapshot_date: string
          sta_nm_anfr: string
          systeme: string
        }
        Update: {
          adresse?: string | null
          commune?: string | null
          created_at?: string | null
          departement?: string | null
          exploitant?: string | null
          frequence_mhz?: number | null
          geom?: unknown
          hauteur_m?: number | null
          id?: string
          puissance_w?: number | null
          radio_id?: string | null
          rayon_couverture_m?: number | null
          snapshot_date?: string
          sta_nm_anfr?: string
          systeme?: string
        }
        Relationships: [
          {
            foreignKeyName: "emetteurs_radio_radio_id_fkey"
            columns: ["radio_id"]
            isOneToOne: false
            referencedRelation: "radios"
            referencedColumns: ["id"]
          },
        ]
      }
      emetteurs_radio_archive: {
        Row: {
          adresse: string | null
          archived_at: string | null
          commune: string | null
          created_at: string | null
          departement: string | null
          exploitant: string | null
          frequence_mhz: number | null
          geom: unknown
          hauteur_m: number | null
          id: string
          puissance_w: number | null
          radio_id: string | null
          rayon_couverture_m: number | null
          snapshot_date: string
          sta_nm_anfr: string
          systeme: string
        }
        Insert: {
          adresse?: string | null
          archived_at?: string | null
          commune?: string | null
          created_at?: string | null
          departement?: string | null
          exploitant?: string | null
          frequence_mhz?: number | null
          geom?: unknown
          hauteur_m?: number | null
          id?: string
          puissance_w?: number | null
          radio_id?: string | null
          rayon_couverture_m?: number | null
          snapshot_date: string
          sta_nm_anfr: string
          systeme: string
        }
        Update: {
          adresse?: string | null
          archived_at?: string | null
          commune?: string | null
          created_at?: string | null
          departement?: string | null
          exploitant?: string | null
          frequence_mhz?: number | null
          geom?: unknown
          hauteur_m?: number | null
          id?: string
          puissance_w?: number | null
          radio_id?: string | null
          rayon_couverture_m?: number | null
          snapshot_date?: string
          sta_nm_anfr?: string
          systeme?: string
        }
        Relationships: [
          {
            foreignKeyName: "emetteurs_radio_archive_radio_id_fkey"
            columns: ["radio_id"]
            isOneToOne: false
            referencedRelation: "radios"
            referencedColumns: ["id"]
          },
        ]
      }
      etalon_alignement: {
        Row: {
          calcule_le: string
          id: boolean
          n_campagnes: number
          score_median: number
          tolerance_pct: number
        }
        Insert: {
          calcule_le?: string
          id?: boolean
          n_campagnes: number
          score_median: number
          tolerance_pct: number
        }
        Update: {
          calcule_le?: string
          id?: boolean
          n_campagnes?: number
          score_median?: number
          tolerance_pct?: number
        }
        Relationships: []
      }
      exposition_cache: {
        Row: {
          calcule_le: string
          cle: string
          lu_le: string
          n_lectures: number
          payload: Json
        }
        Insert: {
          calcule_le?: string
          cle: string
          lu_le?: string
          n_lectures?: number
          payload: Json
        }
        Update: {
          calcule_le?: string
          cle?: string
          lu_le?: string
          n_lectures?: number
          payload?: Json
        }
        Relationships: []
      }
      filosofi_national_averages: {
        Row: {
          avg_value: number | null
          computed_at: string
          feature_name: string
          id: number
          max_value: number | null
          min_value: number | null
          n_carreaux: number | null
          std_value: number | null
        }
        Insert: {
          avg_value?: number | null
          computed_at?: string
          feature_name: string
          id?: number
          max_value?: number | null
          min_value?: number | null
          n_carreaux?: number | null
          std_value?: number | null
        }
        Update: {
          avg_value?: number | null
          computed_at?: string
          feature_name?: string
          id?: number
          max_value?: number | null
          min_value?: number | null
          n_carreaux?: number | null
          std_value?: number | null
        }
        Relationships: []
      }
      france_borders: {
        Row: {
          geom: unknown
          id: number
          nom: string
        }
        Insert: {
          geom: unknown
          id?: number
          nom?: string
        }
        Update: {
          geom?: unknown
          id?: number
          nom?: string
        }
        Relationships: []
      }
      france_boundary: {
        Row: {
          geom: unknown
          id: number
          name: string | null
        }
        Insert: {
          geom?: unknown
          id?: number
          name?: string | null
        }
        Update: {
          geom?: unknown
          id?: number
          name?: string | null
        }
        Relationships: []
      }
      geography_zones: {
        Row: {
          centroid: unknown
          created_at: string | null
          geom: unknown
          geom_simplified: unknown
          id: string
          label: string | null
          name: string
          properties: Json | null
          set_id: string
          source_cache_id: string | null
          source_poi_id: string | null
          surface_km2: number | null
        }
        Insert: {
          centroid?: unknown
          created_at?: string | null
          geom: unknown
          geom_simplified?: unknown
          id?: string
          label?: string | null
          name: string
          properties?: Json | null
          set_id: string
          source_cache_id?: string | null
          source_poi_id?: string | null
          surface_km2?: number | null
        }
        Update: {
          centroid?: unknown
          created_at?: string | null
          geom?: unknown
          geom_simplified?: unknown
          id?: string
          label?: string | null
          name?: string
          properties?: Json | null
          set_id?: string
          source_cache_id?: string | null
          source_poi_id?: string | null
          surface_km2?: number | null
        }
        Relationships: []
      }
      icpe_rubrique_familles: {
        Row: {
          libelle: string
          prefixe: string
          rang_gravite: number
        }
        Insert: {
          libelle: string
          prefixe: string
          rang_gravite: number
        }
        Update: {
          libelle?: string
          prefixe?: string
          rang_gravite?: number
        }
        Relationships: []
      }
      import_runs_ooh: {
        Row: {
          erreurs: Json | null
          id: string
          lance_le: string | null
          nb_doublons: number | null
          nb_erreurs: number | null
          nb_inseres: number | null
          nb_maj: number | null
          nb_total: number | null
          source: string
          statut: string | null
          termine_le: string | null
          url: string | null
        }
        Insert: {
          erreurs?: Json | null
          id?: string
          lance_le?: string | null
          nb_doublons?: number | null
          nb_erreurs?: number | null
          nb_inseres?: number | null
          nb_maj?: number | null
          nb_total?: number | null
          source: string
          statut?: string | null
          termine_le?: string | null
          url?: string | null
        }
        Update: {
          erreurs?: Json | null
          id?: string
          lance_le?: string | null
          nb_doublons?: number | null
          nb_erreurs?: number | null
          nb_inseres?: number | null
          nb_maj?: number | null
          nb_total?: number | null
          source?: string
          statut?: string | null
          termine_le?: string | null
          url?: string | null
        }
        Relationships: []
      }
      indicator_cp_materializations: {
        Row: {
          computed_at: string
          data_source: string
          date_donnee: string | null
          indicator_code: string
          n_lignes: number
        }
        Insert: {
          computed_at?: string
          data_source: string
          date_donnee?: string | null
          indicator_code: string
          n_lignes: number
        }
        Update: {
          computed_at?: string
          data_source?: string
          date_donnee?: string | null
          indicator_code?: string
          n_lignes?: number
        }
        Relationships: []
      }
      indicator_cp_values: {
        Row: {
          computed_at: string
          indicator_code: string
          postal_code: string
          value: number
        }
        Insert: {
          computed_at?: string
          indicator_code: string
          postal_code: string
          value: number
        }
        Update: {
          computed_at?: string
          indicator_code?: string
          postal_code?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "indicator_cp_values_indicator_code_fkey"
            columns: ["indicator_code"]
            isOneToOne: false
            referencedRelation: "cible_indicator_registry"
            referencedColumns: ["indicator_code"]
          },
        ]
      }
      iris: {
        Row: {
          centroid: unknown
          centroid_lat: number | null
          centroid_lng: number | null
          code_commune: string
          code_dept: string | null
          code_iris: string
          code_region: string | null
          created_at: string
          densite_pop: number | null
          geom: unknown
          geom_3857: unknown
          geom_z10: unknown
          geom_z7: unknown
          indicators: Json | null
          indice_gini: number | null
          indice_jeunesse: number | null
          is_true_iris: boolean | null
          nb_csp_cadre: number | null
          nb_csp_employe: number | null
          nb_csp_ouvrier: number | null
          nb_diplome_aucun: number | null
          nb_diplome_bac: number | null
          nb_diplome_sup: number | null
          nb_emplois: number | null
          nb_emplois_commune: number | null
          nb_menages: number | null
          nom_commune: string | null
          nom_iris: string | null
          part_actifs_marche_velo: number | null
          part_actifs_transport_commun: number | null
          part_appartements: number | null
          part_couples_avec_enfants: number | null
          part_familles_monoparentales: number | null
          part_femmes_actives: number | null
          part_hommes_actifs: number | null
          part_logements_sociaux: number | null
          part_menages_emmenages_2ans: number | null
          part_pop_65_plus: number | null
          part_pop_etrangere: number | null
          part_pop_moins_18: number | null
          part_residences_principales: number | null
          part_sans_diplome: number | null
          pop_0_14: number | null
          pop_15_29: number | null
          pop_30_44: number | null
          pop_45_59: number | null
          pop_60_74: number | null
          pop_75_plus: number | null
          population: number | null
          rev_d1: number | null
          rev_d9: number | null
          rev_median: number | null
          taux_chomage: number | null
          taux_diplome_sup: number | null
          taux_emploi: number | null
          taux_pauvrete: number | null
          taux_proprio: number | null
          type_iris: string | null
        }
        Insert: {
          centroid?: unknown
          centroid_lat?: number | null
          centroid_lng?: number | null
          code_commune: string
          code_dept?: string | null
          code_iris: string
          code_region?: string | null
          created_at?: string
          densite_pop?: number | null
          geom?: unknown
          geom_3857?: unknown
          geom_z10?: unknown
          geom_z7?: unknown
          indicators?: Json | null
          indice_gini?: number | null
          indice_jeunesse?: number | null
          is_true_iris?: boolean | null
          nb_csp_cadre?: number | null
          nb_csp_employe?: number | null
          nb_csp_ouvrier?: number | null
          nb_diplome_aucun?: number | null
          nb_diplome_bac?: number | null
          nb_diplome_sup?: number | null
          nb_emplois?: number | null
          nb_emplois_commune?: number | null
          nb_menages?: number | null
          nom_commune?: string | null
          nom_iris?: string | null
          part_actifs_marche_velo?: number | null
          part_actifs_transport_commun?: number | null
          part_appartements?: number | null
          part_couples_avec_enfants?: number | null
          part_familles_monoparentales?: number | null
          part_femmes_actives?: number | null
          part_hommes_actifs?: number | null
          part_logements_sociaux?: number | null
          part_menages_emmenages_2ans?: number | null
          part_pop_65_plus?: number | null
          part_pop_etrangere?: number | null
          part_pop_moins_18?: number | null
          part_residences_principales?: number | null
          part_sans_diplome?: number | null
          pop_0_14?: number | null
          pop_15_29?: number | null
          pop_30_44?: number | null
          pop_45_59?: number | null
          pop_60_74?: number | null
          pop_75_plus?: number | null
          population?: number | null
          rev_d1?: number | null
          rev_d9?: number | null
          rev_median?: number | null
          taux_chomage?: number | null
          taux_diplome_sup?: number | null
          taux_emploi?: number | null
          taux_pauvrete?: number | null
          taux_proprio?: number | null
          type_iris?: string | null
        }
        Update: {
          centroid?: unknown
          centroid_lat?: number | null
          centroid_lng?: number | null
          code_commune?: string
          code_dept?: string | null
          code_iris?: string
          code_region?: string | null
          created_at?: string
          densite_pop?: number | null
          geom?: unknown
          geom_3857?: unknown
          geom_z10?: unknown
          geom_z7?: unknown
          indicators?: Json | null
          indice_gini?: number | null
          indice_jeunesse?: number | null
          is_true_iris?: boolean | null
          nb_csp_cadre?: number | null
          nb_csp_employe?: number | null
          nb_csp_ouvrier?: number | null
          nb_diplome_aucun?: number | null
          nb_diplome_bac?: number | null
          nb_diplome_sup?: number | null
          nb_emplois?: number | null
          nb_emplois_commune?: number | null
          nb_menages?: number | null
          nom_commune?: string | null
          nom_iris?: string | null
          part_actifs_marche_velo?: number | null
          part_actifs_transport_commun?: number | null
          part_appartements?: number | null
          part_couples_avec_enfants?: number | null
          part_familles_monoparentales?: number | null
          part_femmes_actives?: number | null
          part_hommes_actifs?: number | null
          part_logements_sociaux?: number | null
          part_menages_emmenages_2ans?: number | null
          part_pop_65_plus?: number | null
          part_pop_etrangere?: number | null
          part_pop_moins_18?: number | null
          part_residences_principales?: number | null
          part_sans_diplome?: number | null
          pop_0_14?: number | null
          pop_15_29?: number | null
          pop_30_44?: number | null
          pop_45_59?: number | null
          pop_60_74?: number | null
          pop_75_plus?: number | null
          population?: number | null
          rev_d1?: number | null
          rev_d9?: number | null
          rev_median?: number | null
          taux_chomage?: number | null
          taux_diplome_sup?: number | null
          taux_emploi?: number | null
          taux_pauvrete?: number | null
          taux_proprio?: number | null
          type_iris?: string | null
        }
        Relationships: []
      }
      iris_agg_commune: {
        Row: {
          code: string
          densite_pop: number | null
          geom_3857: unknown
          indice_gini: number | null
          indice_jeunesse: number | null
          nb_csp_cadre: number | null
          nb_csp_employe: number | null
          nb_csp_ouvrier: number | null
          nb_diplome_aucun: number | null
          nb_diplome_bac: number | null
          nb_diplome_sup: number | null
          nb_emplois: number | null
          nb_emplois_commune: number | null
          nb_iris: number | null
          nb_menages: number | null
          nom: string | null
          part_actifs_marche_velo: number | null
          part_actifs_transport_commun: number | null
          part_appartements: number | null
          part_couples_avec_enfants: number | null
          part_familles_monoparentales: number | null
          part_femmes_actives: number | null
          part_hommes_actifs: number | null
          part_logements_sociaux: number | null
          part_menages_emmenages_2ans: number | null
          part_pop_65_plus: number | null
          part_pop_etrangere: number | null
          part_pop_moins_18: number | null
          part_residences_principales: number | null
          part_sans_diplome: number | null
          pop_0_14: number | null
          pop_15_29: number | null
          pop_30_44: number | null
          pop_45_59: number | null
          pop_60_74: number | null
          pop_75_plus: number | null
          population: number | null
          rev_d1: number | null
          rev_d9: number | null
          rev_median: number | null
          superficie_km2: number | null
          taux_chomage: number | null
          taux_diplome_sup: number | null
          taux_emploi: number | null
          taux_pauvrete: number | null
          taux_proprio: number | null
        }
        Insert: {
          code: string
          densite_pop?: number | null
          geom_3857?: unknown
          indice_gini?: number | null
          indice_jeunesse?: number | null
          nb_csp_cadre?: number | null
          nb_csp_employe?: number | null
          nb_csp_ouvrier?: number | null
          nb_diplome_aucun?: number | null
          nb_diplome_bac?: number | null
          nb_diplome_sup?: number | null
          nb_emplois?: number | null
          nb_emplois_commune?: number | null
          nb_iris?: number | null
          nb_menages?: number | null
          nom?: string | null
          part_actifs_marche_velo?: number | null
          part_actifs_transport_commun?: number | null
          part_appartements?: number | null
          part_couples_avec_enfants?: number | null
          part_familles_monoparentales?: number | null
          part_femmes_actives?: number | null
          part_hommes_actifs?: number | null
          part_logements_sociaux?: number | null
          part_menages_emmenages_2ans?: number | null
          part_pop_65_plus?: number | null
          part_pop_etrangere?: number | null
          part_pop_moins_18?: number | null
          part_residences_principales?: number | null
          part_sans_diplome?: number | null
          pop_0_14?: number | null
          pop_15_29?: number | null
          pop_30_44?: number | null
          pop_45_59?: number | null
          pop_60_74?: number | null
          pop_75_plus?: number | null
          population?: number | null
          rev_d1?: number | null
          rev_d9?: number | null
          rev_median?: number | null
          superficie_km2?: number | null
          taux_chomage?: number | null
          taux_diplome_sup?: number | null
          taux_emploi?: number | null
          taux_pauvrete?: number | null
          taux_proprio?: number | null
        }
        Update: {
          code?: string
          densite_pop?: number | null
          geom_3857?: unknown
          indice_gini?: number | null
          indice_jeunesse?: number | null
          nb_csp_cadre?: number | null
          nb_csp_employe?: number | null
          nb_csp_ouvrier?: number | null
          nb_diplome_aucun?: number | null
          nb_diplome_bac?: number | null
          nb_diplome_sup?: number | null
          nb_emplois?: number | null
          nb_emplois_commune?: number | null
          nb_iris?: number | null
          nb_menages?: number | null
          nom?: string | null
          part_actifs_marche_velo?: number | null
          part_actifs_transport_commun?: number | null
          part_appartements?: number | null
          part_couples_avec_enfants?: number | null
          part_familles_monoparentales?: number | null
          part_femmes_actives?: number | null
          part_hommes_actifs?: number | null
          part_logements_sociaux?: number | null
          part_menages_emmenages_2ans?: number | null
          part_pop_65_plus?: number | null
          part_pop_etrangere?: number | null
          part_pop_moins_18?: number | null
          part_residences_principales?: number | null
          part_sans_diplome?: number | null
          pop_0_14?: number | null
          pop_15_29?: number | null
          pop_30_44?: number | null
          pop_45_59?: number | null
          pop_60_74?: number | null
          pop_75_plus?: number | null
          population?: number | null
          rev_d1?: number | null
          rev_d9?: number | null
          rev_median?: number | null
          superficie_km2?: number | null
          taux_chomage?: number | null
          taux_diplome_sup?: number | null
          taux_emploi?: number | null
          taux_pauvrete?: number | null
          taux_proprio?: number | null
        }
        Relationships: []
      }
      iris_agg_departement: {
        Row: {
          code: string
          densite_pop: number | null
          geom_3857: unknown
          indice_gini: number | null
          indice_jeunesse: number | null
          nb_csp_cadre: number | null
          nb_csp_employe: number | null
          nb_csp_ouvrier: number | null
          nb_diplome_aucun: number | null
          nb_diplome_bac: number | null
          nb_diplome_sup: number | null
          nb_emplois: number | null
          nb_emplois_commune: number | null
          nb_iris: number | null
          nb_menages: number | null
          nom: string | null
          part_actifs_marche_velo: number | null
          part_actifs_transport_commun: number | null
          part_appartements: number | null
          part_couples_avec_enfants: number | null
          part_familles_monoparentales: number | null
          part_femmes_actives: number | null
          part_hommes_actifs: number | null
          part_logements_sociaux: number | null
          part_menages_emmenages_2ans: number | null
          part_pop_65_plus: number | null
          part_pop_etrangere: number | null
          part_pop_moins_18: number | null
          part_residences_principales: number | null
          part_sans_diplome: number | null
          pop_0_14: number | null
          pop_15_29: number | null
          pop_30_44: number | null
          pop_45_59: number | null
          pop_60_74: number | null
          pop_75_plus: number | null
          population: number | null
          rev_d1: number | null
          rev_d9: number | null
          rev_median: number | null
          superficie_km2: number | null
          taux_chomage: number | null
          taux_diplome_sup: number | null
          taux_emploi: number | null
          taux_pauvrete: number | null
          taux_proprio: number | null
        }
        Insert: {
          code: string
          densite_pop?: number | null
          geom_3857?: unknown
          indice_gini?: number | null
          indice_jeunesse?: number | null
          nb_csp_cadre?: number | null
          nb_csp_employe?: number | null
          nb_csp_ouvrier?: number | null
          nb_diplome_aucun?: number | null
          nb_diplome_bac?: number | null
          nb_diplome_sup?: number | null
          nb_emplois?: number | null
          nb_emplois_commune?: number | null
          nb_iris?: number | null
          nb_menages?: number | null
          nom?: string | null
          part_actifs_marche_velo?: number | null
          part_actifs_transport_commun?: number | null
          part_appartements?: number | null
          part_couples_avec_enfants?: number | null
          part_familles_monoparentales?: number | null
          part_femmes_actives?: number | null
          part_hommes_actifs?: number | null
          part_logements_sociaux?: number | null
          part_menages_emmenages_2ans?: number | null
          part_pop_65_plus?: number | null
          part_pop_etrangere?: number | null
          part_pop_moins_18?: number | null
          part_residences_principales?: number | null
          part_sans_diplome?: number | null
          pop_0_14?: number | null
          pop_15_29?: number | null
          pop_30_44?: number | null
          pop_45_59?: number | null
          pop_60_74?: number | null
          pop_75_plus?: number | null
          population?: number | null
          rev_d1?: number | null
          rev_d9?: number | null
          rev_median?: number | null
          superficie_km2?: number | null
          taux_chomage?: number | null
          taux_diplome_sup?: number | null
          taux_emploi?: number | null
          taux_pauvrete?: number | null
          taux_proprio?: number | null
        }
        Update: {
          code?: string
          densite_pop?: number | null
          geom_3857?: unknown
          indice_gini?: number | null
          indice_jeunesse?: number | null
          nb_csp_cadre?: number | null
          nb_csp_employe?: number | null
          nb_csp_ouvrier?: number | null
          nb_diplome_aucun?: number | null
          nb_diplome_bac?: number | null
          nb_diplome_sup?: number | null
          nb_emplois?: number | null
          nb_emplois_commune?: number | null
          nb_iris?: number | null
          nb_menages?: number | null
          nom?: string | null
          part_actifs_marche_velo?: number | null
          part_actifs_transport_commun?: number | null
          part_appartements?: number | null
          part_couples_avec_enfants?: number | null
          part_familles_monoparentales?: number | null
          part_femmes_actives?: number | null
          part_hommes_actifs?: number | null
          part_logements_sociaux?: number | null
          part_menages_emmenages_2ans?: number | null
          part_pop_65_plus?: number | null
          part_pop_etrangere?: number | null
          part_pop_moins_18?: number | null
          part_residences_principales?: number | null
          part_sans_diplome?: number | null
          pop_0_14?: number | null
          pop_15_29?: number | null
          pop_30_44?: number | null
          pop_45_59?: number | null
          pop_60_74?: number | null
          pop_75_plus?: number | null
          population?: number | null
          rev_d1?: number | null
          rev_d9?: number | null
          rev_median?: number | null
          superficie_km2?: number | null
          taux_chomage?: number | null
          taux_diplome_sup?: number | null
          taux_emploi?: number | null
          taux_pauvrete?: number | null
          taux_proprio?: number | null
        }
        Relationships: []
      }
      iris_bornes_echelle: {
        Row: {
          classe: string
          colonne: string
          log_max: number
          log_min: number
          mesure_le: string
          val_max: number
          val_min: number
        }
        Insert: {
          classe: string
          colonne: string
          log_max: number
          log_min: number
          mesure_le?: string
          val_max: number
          val_min: number
        }
        Update: {
          classe?: string
          colonne?: string
          log_max?: number
          log_min?: number
          mesure_le?: string
          val_max?: number
          val_min?: number
        }
        Relationships: []
      }
      iris_import_history: {
        Row: {
          column_mapping: Json | null
          created_at: string | null
          error_details: Json | null
          error_rows: number | null
          filename: string
          id: string
          inserted_rows: number | null
          status: string | null
          total_rows: number
          updated_rows: number | null
          user_id: string | null
        }
        Insert: {
          column_mapping?: Json | null
          created_at?: string | null
          error_details?: Json | null
          error_rows?: number | null
          filename: string
          id?: string
          inserted_rows?: number | null
          status?: string | null
          total_rows: number
          updated_rows?: number | null
          user_id?: string | null
        }
        Update: {
          column_mapping?: Json | null
          created_at?: string | null
          error_details?: Json | null
          error_rows?: number | null
          filename?: string
          id?: string
          inserted_rows?: number | null
          status?: string | null
          total_rows?: number
          updated_rows?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      iris_indicator_registry: {
        Row: {
          dataset: string
          imported_at: string | null
          key: string
          label: string | null
          sample_values: Json | null
          type: string | null
        }
        Insert: {
          dataset: string
          imported_at?: string | null
          key: string
          label?: string | null
          sample_values?: Json | null
          type?: string | null
        }
        Update: {
          dataset?: string
          imported_at?: string | null
          key?: string
          label?: string | null
          sample_values?: Json | null
          type?: string | null
        }
        Relationships: []
      }
      iris_metadata: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      isochrones_cache: {
        Row: {
          cache_key: string
          categorie: string | null
          created_at: string | null
          geojson: Json
          geom: unknown
          geom_simplified: unknown
          id: string
          minutes: number
          mode: string
          poi_count: number | null
          ville: string
        }
        Insert: {
          cache_key: string
          categorie?: string | null
          created_at?: string | null
          geojson: Json
          geom?: unknown
          geom_simplified?: unknown
          id?: string
          minutes: number
          mode?: string
          poi_count?: number | null
          ville: string
        }
        Update: {
          cache_key?: string
          categorie?: string | null
          created_at?: string | null
          geojson?: Json
          geom?: unknown
          geom_simplified?: unknown
          id?: string
          minutes?: number
          mode?: string
          poi_count?: number | null
          ville?: string
        }
        Relationships: []
      }
      laposte_hexasmal: {
        Row: {
          centroid: unknown
          code_commune_insee: string
          code_postal: string
          created_at: string | null
          id: number
          latitude: number | null
          libelle_acheminement: string | null
          ligne_5: string | null
          longitude: number | null
          nom_de_la_commune: string | null
        }
        Insert: {
          centroid?: unknown
          code_commune_insee: string
          code_postal: string
          created_at?: string | null
          id?: number
          latitude?: number | null
          libelle_acheminement?: string | null
          ligne_5?: string | null
          longitude?: number | null
          nom_de_la_commune?: string | null
        }
        Update: {
          centroid?: unknown
          code_commune_insee?: string
          code_postal?: string
          created_at?: string | null
          id?: number
          latitude?: number | null
          libelle_acheminement?: string | null
          ligne_5?: string | null
          longitude?: number | null
          nom_de_la_commune?: string | null
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          id: string
          joined_at: string | null
          organization_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string | null
          organization_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string | null
          organization_id?: string
          user_id?: string
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
          active: boolean
          config: Json
          created_at: string | null
          description: string | null
          id: string
          logo_url: string | null
          name: string
          slug: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          config?: Json
          created_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          config?: Json
          created_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      panneaux_affichage: {
        Row: {
          actif: boolean | null
          adresse: string | null
          bonus_isochrone: number | null
          code_departement: string | null
          code_insee: string | null
          code_postal: string | null
          data_source_id: string | null
          date_enrichissement: string | null
          date_import: string | null
          date_maj: string | null
          densite_population: number | null
          departement: string | null
          enrichissement_complet: boolean | null
          flux_routier_distance_m: number | null
          flux_routier_route: string | null
          flux_routier_tmja: number | null
          geom: unknown
          id: string
          in_isochrone_cirfa: boolean | null
          in_isochrone_lycee: boolean | null
          isochrone_cirfa_minutes: number | null
          isochrone_lycee_minutes: number | null
          lat: number
          lng: number
          metadata: Json | null
          nb_arrets_300m: number | null
          nb_faces: number | null
          nb_lycees_1000m: number | null
          nb_lycees_300m: number | null
          nb_lycees_500m: number | null
          nb_menages: number | null
          nb_poi_gare_500m: number | null
          nb_poi_salle_sport_500m: number | null
          nb_poi_supermarche_500m: number | null
          organization_id: string | null
          poi_cirfa_distance_min: number | null
          poi_cirfa_nom_proche: string | null
          poi_lycee_distance_min: number | null
          poi_lycee_nom_proche: string | null
          poi_lycee_type_proche: string | null
          poi_transport_distance_min: number | null
          poi_transport_nom_proche: string | null
          reference_panneau: string | null
          regie: string | null
          region: string | null
          revenu_median: number | null
          score_age_0_14: number | null
          score_age_15_29: number | null
          score_age_30_44: number | null
          score_age_45_64: number | null
          score_age_65_plus: number | null
          score_computed_at: string | null
          score_demo: number | null
          score_flux_routier: number | null
          score_ooh_final: number | null
          score_ooh_total: number | null
          score_proximite_cirfa: number | null
          score_proximite_lycee: number | null
          score_transport: number | null
          scoring_profile_id: string | null
          scoring_results: Json | null
          source: string | null
          source_insee: string | null
          source_ref: string | null
          type_panneau: string | null
          ville: string | null
        }
        Insert: {
          actif?: boolean | null
          adresse?: string | null
          bonus_isochrone?: number | null
          code_departement?: string | null
          code_insee?: string | null
          code_postal?: string | null
          data_source_id?: string | null
          date_enrichissement?: string | null
          date_import?: string | null
          date_maj?: string | null
          densite_population?: number | null
          departement?: string | null
          enrichissement_complet?: boolean | null
          flux_routier_distance_m?: number | null
          flux_routier_route?: string | null
          flux_routier_tmja?: number | null
          geom: unknown
          id?: string
          in_isochrone_cirfa?: boolean | null
          in_isochrone_lycee?: boolean | null
          isochrone_cirfa_minutes?: number | null
          isochrone_lycee_minutes?: number | null
          lat: number
          lng: number
          metadata?: Json | null
          nb_arrets_300m?: number | null
          nb_faces?: number | null
          nb_lycees_1000m?: number | null
          nb_lycees_300m?: number | null
          nb_lycees_500m?: number | null
          nb_menages?: number | null
          nb_poi_gare_500m?: number | null
          nb_poi_salle_sport_500m?: number | null
          nb_poi_supermarche_500m?: number | null
          organization_id?: string | null
          poi_cirfa_distance_min?: number | null
          poi_cirfa_nom_proche?: string | null
          poi_lycee_distance_min?: number | null
          poi_lycee_nom_proche?: string | null
          poi_lycee_type_proche?: string | null
          poi_transport_distance_min?: number | null
          poi_transport_nom_proche?: string | null
          reference_panneau?: string | null
          regie?: string | null
          region?: string | null
          revenu_median?: number | null
          score_age_0_14?: number | null
          score_age_15_29?: number | null
          score_age_30_44?: number | null
          score_age_45_64?: number | null
          score_age_65_plus?: number | null
          score_computed_at?: string | null
          score_demo?: number | null
          score_flux_routier?: number | null
          score_ooh_final?: number | null
          score_ooh_total?: number | null
          score_proximite_cirfa?: number | null
          score_proximite_lycee?: number | null
          score_transport?: number | null
          scoring_profile_id?: string | null
          scoring_results?: Json | null
          source?: string | null
          source_insee?: string | null
          source_ref?: string | null
          type_panneau?: string | null
          ville?: string | null
        }
        Update: {
          actif?: boolean | null
          adresse?: string | null
          bonus_isochrone?: number | null
          code_departement?: string | null
          code_insee?: string | null
          code_postal?: string | null
          data_source_id?: string | null
          date_enrichissement?: string | null
          date_import?: string | null
          date_maj?: string | null
          densite_population?: number | null
          departement?: string | null
          enrichissement_complet?: boolean | null
          flux_routier_distance_m?: number | null
          flux_routier_route?: string | null
          flux_routier_tmja?: number | null
          geom?: unknown
          id?: string
          in_isochrone_cirfa?: boolean | null
          in_isochrone_lycee?: boolean | null
          isochrone_cirfa_minutes?: number | null
          isochrone_lycee_minutes?: number | null
          lat?: number
          lng?: number
          metadata?: Json | null
          nb_arrets_300m?: number | null
          nb_faces?: number | null
          nb_lycees_1000m?: number | null
          nb_lycees_300m?: number | null
          nb_lycees_500m?: number | null
          nb_menages?: number | null
          nb_poi_gare_500m?: number | null
          nb_poi_salle_sport_500m?: number | null
          nb_poi_supermarche_500m?: number | null
          organization_id?: string | null
          poi_cirfa_distance_min?: number | null
          poi_cirfa_nom_proche?: string | null
          poi_lycee_distance_min?: number | null
          poi_lycee_nom_proche?: string | null
          poi_lycee_type_proche?: string | null
          poi_transport_distance_min?: number | null
          poi_transport_nom_proche?: string | null
          reference_panneau?: string | null
          regie?: string | null
          region?: string | null
          revenu_median?: number | null
          score_age_0_14?: number | null
          score_age_15_29?: number | null
          score_age_30_44?: number | null
          score_age_45_64?: number | null
          score_age_65_plus?: number | null
          score_computed_at?: string | null
          score_demo?: number | null
          score_flux_routier?: number | null
          score_ooh_final?: number | null
          score_ooh_total?: number | null
          score_proximite_cirfa?: number | null
          score_proximite_lycee?: number | null
          score_transport?: number | null
          scoring_profile_id?: string | null
          scoring_results?: Json | null
          source?: string | null
          source_insee?: string | null
          source_ref?: string | null
          type_panneau?: string | null
          ville?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "panneaux_affichage_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panneaux_affichage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_categories: {
        Row: {
          actif: boolean | null
          categorie: string
          couleur_carte: string | null
          created_at: string | null
          description: string | null
          icone: string | null
          id: string
          label_fr: string
          source_defaut: string | null
          sous_categorie: string | null
        }
        Insert: {
          actif?: boolean | null
          categorie: string
          couleur_carte?: string | null
          created_at?: string | null
          description?: string | null
          icone?: string | null
          id?: string
          label_fr: string
          source_defaut?: string | null
          sous_categorie?: string | null
        }
        Update: {
          actif?: boolean | null
          categorie?: string
          couleur_carte?: string | null
          created_at?: string | null
          description?: string | null
          icone?: string | null
          id?: string
          label_fr?: string
          source_defaut?: string | null
          sous_categorie?: string | null
        }
        Relationships: []
      }
      poi_cluster_history: {
        Row: {
          action: string
          changed: boolean | null
          cluster_id: number
          cluster_label: string | null
          created_at: string | null
          distance_to_centroid: number | null
          duration_minutes: number | null
          id: number
          mode: string | null
          model_version: number
          pca_components: Json | null
          poi_id: string
          previous_cluster_id: number | null
          profile_features: Json | null
        }
        Insert: {
          action: string
          changed?: boolean | null
          cluster_id: number
          cluster_label?: string | null
          created_at?: string | null
          distance_to_centroid?: number | null
          duration_minutes?: number | null
          id?: number
          mode?: string | null
          model_version: number
          pca_components?: Json | null
          poi_id: string
          previous_cluster_id?: number | null
          profile_features?: Json | null
        }
        Update: {
          action?: string
          changed?: boolean | null
          cluster_id?: number
          cluster_label?: string | null
          created_at?: string | null
          distance_to_centroid?: number | null
          duration_minutes?: number | null
          id?: number
          mode?: string | null
          model_version?: number
          pca_components?: Json | null
          poi_id?: string
          previous_cluster_id?: number | null
          profile_features?: Json | null
        }
        Relationships: []
      }
      poi_clusters: {
        Row: {
          cluster_avg_profile: Json | null
          cluster_id: number
          cluster_label: string | null
          created_at: string | null
          duration_minutes: number
          id: number
          imputed_features: Json | null
          mode: string
          model_version: number
          n_carreaux_intersected: number | null
          pca_components: Json | null
          poi_id: string
          population_totale_couverte: number | null
          profil_palier: string | null
          profile_features: Json | null
          updated_at: string | null
        }
        Insert: {
          cluster_avg_profile?: Json | null
          cluster_id: number
          cluster_label?: string | null
          created_at?: string | null
          duration_minutes?: number
          id?: number
          imputed_features?: Json | null
          mode?: string
          model_version?: number
          n_carreaux_intersected?: number | null
          pca_components?: Json | null
          poi_id: string
          population_totale_couverte?: number | null
          profil_palier?: string | null
          profile_features?: Json | null
          updated_at?: string | null
        }
        Update: {
          cluster_avg_profile?: Json | null
          cluster_id?: number
          cluster_label?: string | null
          created_at?: string | null
          duration_minutes?: number
          id?: number
          imputed_features?: Json | null
          mode?: string
          model_version?: number
          n_carreaux_intersected?: number | null
          pca_components?: Json | null
          poi_id?: string
          population_totale_couverte?: number | null
          profil_palier?: string | null
          profile_features?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poi_clusters_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "poi_france"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_france: {
        Row: {
          adresse: string | null
          categorie: string
          code_departement: string | null
          code_postal: string | null
          data_source_id: string | null
          date_import: string | null
          departement: string | null
          geom: unknown
          id: string
          lat: number
          lng: number
          metadata: Json | null
          needs_clustering: boolean | null
          nom: string | null
          organization_id: string | null
          region: string | null
          source: string | null
          sous_categorie: string | null
          ville: string | null
        }
        Insert: {
          adresse?: string | null
          categorie: string
          code_departement?: string | null
          code_postal?: string | null
          data_source_id?: string | null
          date_import?: string | null
          departement?: string | null
          geom: unknown
          id?: string
          lat: number
          lng: number
          metadata?: Json | null
          needs_clustering?: boolean | null
          nom?: string | null
          organization_id?: string | null
          region?: string | null
          source?: string | null
          sous_categorie?: string | null
          ville?: string | null
        }
        Update: {
          adresse?: string | null
          categorie?: string
          code_departement?: string | null
          code_postal?: string | null
          data_source_id?: string | null
          date_import?: string | null
          departement?: string | null
          geom?: unknown
          id?: string
          lat?: number
          lng?: number
          metadata?: Json | null
          needs_clustering?: boolean | null
          nom?: string | null
          organization_id?: string | null
          region?: string | null
          source?: string | null
          sous_categorie?: string | null
          ville?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poi_france_categorie_fkey"
            columns: ["categorie"]
            isOneToOne: false
            referencedRelation: "poi_categories"
            referencedColumns: ["categorie"]
          },
          {
            foreignKeyName: "poi_france_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_france_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pollen_map_daily: {
        Row: {
          alerte: boolean
          ambroisie: number
          armoise: number
          aulne: number
          bouleau: number
          code_postal: string
          conc_ambroisie: number
          conc_armoise: number
          conc_aulne: number
          conc_bouleau: number
          conc_graminees: number
          conc_olivier: number
          date_ech: string
          graminees: number
          indice_global: number
          nb_communes: number
          olivier: number
          updated_at: string
        }
        Insert: {
          alerte?: boolean
          ambroisie?: number
          armoise?: number
          aulne?: number
          bouleau?: number
          code_postal: string
          conc_ambroisie?: number
          conc_armoise?: number
          conc_aulne?: number
          conc_bouleau?: number
          conc_graminees?: number
          conc_olivier?: number
          date_ech: string
          graminees?: number
          indice_global?: number
          nb_communes?: number
          olivier?: number
          updated_at?: string
        }
        Update: {
          alerte?: boolean
          ambroisie?: number
          armoise?: number
          aulne?: number
          bouleau?: number
          code_postal?: string
          conc_ambroisie?: number
          conc_armoise?: number
          conc_aulne?: number
          conc_bouleau?: number
          conc_graminees?: number
          conc_olivier?: number
          date_ech?: string
          graminees?: number
          indice_global?: number
          nb_communes?: number
          olivier?: number
          updated_at?: string
        }
        Relationships: []
      }
      postal_code_commune: {
        Row: {
          code_commune: string
          code_postal: string
          nom_commune: string | null
        }
        Insert: {
          code_commune: string
          code_postal: string
          nom_commune?: string | null
        }
        Update: {
          code_commune?: string
          code_postal?: string
          nom_commune?: string | null
        }
        Relationships: []
      }
      pprt_documents: {
        Row: {
          bassin_risques: string | null
          code_departement_pilote: string | null
          date_modification: string | null
          en_revision: boolean
          id_gaspar: string
          importe_le: string
          modele: string | null
          nom: string
          nom_departement_pilote: string | null
          source: string
          sup_existe: boolean
          types_zones: Json
          zonage_existe: boolean
        }
        Insert: {
          bassin_risques?: string | null
          code_departement_pilote?: string | null
          date_modification?: string | null
          en_revision?: boolean
          id_gaspar: string
          importe_le?: string
          modele?: string | null
          nom: string
          nom_departement_pilote?: string | null
          source?: string
          sup_existe?: boolean
          types_zones?: Json
          zonage_existe?: boolean
        }
        Update: {
          bassin_risques?: string | null
          code_departement_pilote?: string | null
          date_modification?: string | null
          en_revision?: boolean
          id_gaspar?: string
          importe_le?: string
          modele?: string | null
          nom?: string
          nom_departement_pilote?: string | null
          source?: string
          sup_existe?: boolean
          types_zones?: Json
          zonage_existe?: boolean
        }
        Relationships: []
      }
      pprt_niveau_generateur: {
        Row: {
          geom_3857: unknown
          niveau: string | null
          pprt_id: string
        }
        Insert: {
          geom_3857: unknown
          niveau?: string | null
          pprt_id: string
        }
        Update: {
          geom_3857?: unknown
          niveau?: string | null
          pprt_id?: string
        }
        Relationships: []
      }
      pprt_perimetres: {
        Row: {
          code_departement: string | null
          code_region: string | null
          date_source: string | null
          depot_code: string | null
          depot_niveau: string | null
          document_source: string | null
          fichier_acte: string | null
          geom: unknown
          geom_3857: unknown
          id: string
          id_assiette: string | null
          id_gaspar: string | null
          id_generateur: string | null
          importe_le: string
          mode_geometrie: string | null
          nom: string
          nom_departement: string | null
          nom_technique: string | null
          partition: string
          source: string
          superficie_km2: number | null
          type_zone: string
          type_zone_source: string | null
        }
        Insert: {
          code_departement?: string | null
          code_region?: string | null
          date_source?: string | null
          depot_code?: string | null
          depot_niveau?: string | null
          document_source?: string | null
          fichier_acte?: string | null
          geom: unknown
          geom_3857: unknown
          id: string
          id_assiette?: string | null
          id_gaspar?: string | null
          id_generateur?: string | null
          importe_le?: string
          mode_geometrie?: string | null
          nom: string
          nom_departement?: string | null
          nom_technique?: string | null
          partition: string
          source?: string
          superficie_km2?: number | null
          type_zone: string
          type_zone_source?: string | null
        }
        Update: {
          code_departement?: string | null
          code_region?: string | null
          date_source?: string | null
          depot_code?: string | null
          depot_niveau?: string | null
          document_source?: string | null
          fichier_acte?: string | null
          geom?: unknown
          geom_3857?: unknown
          id?: string
          id_assiette?: string | null
          id_gaspar?: string | null
          id_generateur?: string | null
          importe_le?: string
          mode_geometrie?: string | null
          nom?: string
          nom_departement?: string | null
          nom_technique?: string | null
          partition?: string
          source?: string
          superficie_km2?: number | null
          type_zone?: string
          type_zone_source?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          demo_mode: boolean
          email: string
          full_name: string | null
          id: string
          organization_id: string | null
          role: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          demo_mode?: boolean
          email: string
          full_name?: string | null
          id: string
          organization_id?: string | null
          role?: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          demo_mode?: boolean
          email?: string
          full_name?: string | null
          id?: string
          organization_id?: string | null
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qualite_releves: {
        Row: {
          calcule_le: string
          duree_ms: number | null
          releve: Json
          verification: string
        }
        Insert: {
          calcule_le?: string
          duree_ms?: number | null
          releve: Json
          verification: string
        }
        Update: {
          calcule_le?: string
          duree_ms?: number | null
          releve?: Json
          verification?: string
        }
        Relationships: []
      }
      quotas_appels: {
        Row: {
          cle: string
          compte: number
          fenetre_fin: string
        }
        Insert: {
          cle: string
          compte?: number
          fenetre_fin: string
        }
        Update: {
          cle?: string
          compte?: number
          fenetre_fin?: string
        }
        Relationships: []
      }
      radio_import_log_entries: {
        Row: {
          details: Json | null
          duration_ms: number | null
          id: string
          import_log_id: string
          level: string
          message: string
          phase: string
          timestamp: string | null
        }
        Insert: {
          details?: Json | null
          duration_ms?: number | null
          id?: string
          import_log_id: string
          level: string
          message: string
          phase: string
          timestamp?: string | null
        }
        Update: {
          details?: Json | null
          duration_ms?: number | null
          id?: string
          import_log_id?: string
          level?: string
          message?: string
          phase?: string
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "radio_import_log_entries_import_log_id_fkey"
            columns: ["import_log_id"]
            isOneToOne: false
            referencedRelation: "radio_imports_log"
            referencedColumns: ["id"]
          },
        ]
      }
      radio_imports_log: {
        Row: {
          completed_at: string | null
          created_by: string | null
          error_message: string | null
          id: string
          source_file: string | null
          started_at: string | null
          stats: Json | null
          status: string
          type: string
        }
        Insert: {
          completed_at?: string | null
          created_by?: string | null
          error_message?: string | null
          id?: string
          source_file?: string | null
          started_at?: string | null
          stats?: Json | null
          status: string
          type: string
        }
        Update: {
          completed_at?: string | null
          created_by?: string | null
          error_message?: string | null
          id?: string
          source_file?: string | null
          started_at?: string | null
          stats?: Json | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      radios: {
        Row: {
          audience_data: Json | null
          audience_updated_at: string | null
          categorie_arcom: string | null
          created_at: string | null
          genre: string | null
          groupe_media: string | null
          id: string
          logo_url: string | null
          metadata: Json | null
          nom: string
          parent_radio_id: string | null
          portee: string | null
          site_web: string | null
          tarifs_data: Json | null
          tarifs_updated_at: string | null
          updated_at: string | null
        }
        Insert: {
          audience_data?: Json | null
          audience_updated_at?: string | null
          categorie_arcom?: string | null
          created_at?: string | null
          genre?: string | null
          groupe_media?: string | null
          id?: string
          logo_url?: string | null
          metadata?: Json | null
          nom: string
          parent_radio_id?: string | null
          portee?: string | null
          site_web?: string | null
          tarifs_data?: Json | null
          tarifs_updated_at?: string | null
          updated_at?: string | null
        }
        Update: {
          audience_data?: Json | null
          audience_updated_at?: string | null
          categorie_arcom?: string | null
          created_at?: string | null
          genre?: string | null
          groupe_media?: string | null
          id?: string
          logo_url?: string | null
          metadata?: Json | null
          nom?: string
          parent_radio_id?: string | null
          portee?: string | null
          site_web?: string | null
          tarifs_data?: Json | null
          tarifs_updated_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "radios_parent_radio_id_fkey"
            columns: ["parent_radio_id"]
            isOneToOne: false
            referencedRelation: "radios"
            referencedColumns: ["id"]
          },
        ]
      }
      ref_codes_postaux: {
        Row: {
          centroid: unknown
          centroid_lat: number | null
          centroid_lon: number | null
          code_dept: string | null
          code_postal: string
          created_at: string | null
          geom: unknown
          geom_simplified: unknown
          nb_communes: number
          nom_principal: string | null
          pop_total: number | null
          surface_km2: number | null
        }
        Insert: {
          centroid?: unknown
          centroid_lat?: number | null
          centroid_lon?: number | null
          code_dept?: string | null
          code_postal: string
          created_at?: string | null
          geom?: unknown
          geom_simplified?: unknown
          nb_communes?: number
          nom_principal?: string | null
          pop_total?: number | null
          surface_km2?: number | null
        }
        Update: {
          centroid?: unknown
          centroid_lat?: number | null
          centroid_lon?: number | null
          code_dept?: string | null
          code_postal?: string
          created_at?: string | null
          geom?: unknown
          geom_simplified?: unknown
          nb_communes?: number
          nom_principal?: string | null
          pop_total?: number | null
          surface_km2?: number | null
        }
        Relationships: []
      }
      ref_communes: {
        Row: {
          code_commune: string
          code_dept: string | null
          code_region: string | null
          geom: unknown
          nom_commune: string | null
        }
        Insert: {
          code_commune: string
          code_dept?: string | null
          code_region?: string | null
          geom?: unknown
          nom_commune?: string | null
        }
        Update: {
          code_commune?: string
          code_dept?: string | null
          code_region?: string | null
          geom?: unknown
          nom_commune?: string | null
        }
        Relationships: []
      }
      ref_departements: {
        Row: {
          centroid_lat: number | null
          centroid_lon: number | null
          code_dept: string
          code_region: string | null
          geom: unknown
          nom_dept: string | null
        }
        Insert: {
          centroid_lat?: number | null
          centroid_lon?: number | null
          code_dept: string
          code_region?: string | null
          geom?: unknown
          nom_dept?: string | null
        }
        Update: {
          centroid_lat?: number | null
          centroid_lon?: number | null
          code_dept?: string
          code_region?: string | null
          geom?: unknown
          nom_dept?: string | null
        }
        Relationships: []
      }
      ref_regions: {
        Row: {
          centroid_lat: number | null
          centroid_lon: number | null
          code_region: string
          geom: unknown
          nom_region: string
        }
        Insert: {
          centroid_lat?: number | null
          centroid_lon?: number | null
          code_region: string
          geom?: unknown
          nom_region: string
        }
        Update: {
          centroid_lat?: number | null
          centroid_lon?: number | null
          code_region?: string
          geom?: unknown
          nom_region?: string
        }
        Relationships: []
      }
      saved_maps: {
        Row: {
          carreaux_config: Json | null
          created_at: string | null
          id: string
          isochrone_data: Json | null
          messages: Json | null
          name: string
          nb_pois: number | null
          organization_id: string | null
          updated_at: string | null
          user_id: string | null
          ville: string | null
          zone_data: Json | null
        }
        Insert: {
          carreaux_config?: Json | null
          created_at?: string | null
          id?: string
          isochrone_data?: Json | null
          messages?: Json | null
          name: string
          nb_pois?: number | null
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          ville?: string | null
          zone_data?: Json | null
        }
        Update: {
          carreaux_config?: Json | null
          created_at?: string | null
          id?: string
          isochrone_data?: Json | null
          messages?: Json | null
          name?: string
          nb_pois?: number | null
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          ville?: string | null
          zone_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_maps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      seveso_exposition: {
        Row: {
          calcule_le: string
          id: number
          indicatif: boolean
          mode: string
          nb_carreaux: number
          palier: string
          pop_couronne: number
          pop_exposee: number
          site_id: string
          surface_km2: number | null
        }
        Insert: {
          calcule_le?: string
          id?: number
          indicatif: boolean
          mode: string
          nb_carreaux?: number
          palier: string
          pop_couronne?: number
          pop_exposee?: number
          site_id: string
          surface_km2?: number | null
        }
        Update: {
          calcule_le?: string
          id?: number
          indicatif?: boolean
          mode?: string
          nb_carreaux?: number
          palier?: string
          pop_couronne?: number
          pop_exposee?: number
          site_id?: string
          surface_km2?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "seveso_exposition_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "poi_france"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_prompt_feedback: {
        Row: {
          agent: string | null
          confidence: number | null
          created_at: string
          error_msg: string | null
          id: number
          message: string
          params: Json | null
          success: boolean | null
          user_id: string | null
        }
        Insert: {
          agent?: string | null
          confidence?: number | null
          created_at?: string
          error_msg?: string | null
          id?: number
          message: string
          params?: Json | null
          success?: boolean | null
          user_id?: string | null
        }
        Update: {
          agent?: string | null
          confidence?: number | null
          created_at?: string
          error_msg?: string | null
          id?: number
          message?: string
          params?: Json | null
          success?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      smart_ville_stats: {
        Row: {
          indicateur: string
          lat: number
          lng: number
          total: number
          updated_at: string
          ville: string
        }
        Insert: {
          indicateur: string
          lat: number
          lng: number
          total: number
          updated_at?: string
          ville: string
        }
        Update: {
          indicateur?: string
          lat?: number
          lng?: number
          total?: number
          updated_at?: string
          ville?: string
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      strategie_versions: {
        Row: {
          charge_utile: Json
          empreinte_zones: Json
          id: string
          publiee_le: string
          publiee_par: string
          strategie_id: string
          version: number
        }
        Insert: {
          charge_utile: Json
          empreinte_zones?: Json
          id?: string
          publiee_le?: string
          publiee_par: string
          strategie_id: string
          version: number
        }
        Update: {
          charge_utile?: Json
          empreinte_zones?: Json
          id?: string
          publiee_le?: string
          publiee_par?: string
          strategie_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "strategie_versions_strategie_id_fkey"
            columns: ["strategie_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_changes: {
        Row: {
          change_type: string
          created_at: string
          field_path: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          reason: string | null
          strategy_id: string
          triggered_by: string
          user_id: string | null
        }
        Insert: {
          change_type: string
          created_at?: string
          field_path?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          strategy_id: string
          triggered_by?: string
          user_id?: string | null
        }
        Update: {
          change_type?: string
          created_at?: string
          field_path?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          strategy_id?: string
          triggered_by?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "strategy_changes_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "bidding_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      zones_risque_cache: {
        Row: {
          bande: number | null
          classe: string
          construit_le: string
          geom: unknown
          geom_3857: unknown
          niveau: string
          profil_code: string
          surface_km2: number | null
        }
        Insert: {
          bande?: number | null
          classe: string
          construit_le?: string
          geom: unknown
          geom_3857: unknown
          niveau: string
          profil_code: string
          surface_km2?: number | null
        }
        Update: {
          bande?: number | null
          classe?: string
          construit_le?: string
          geom?: unknown
          geom_3857?: unknown
          niveau?: string
          profil_code?: string
          surface_km2?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      carreaux_20km: {
        Row: {
          familles_monoparentales: number | null
          geom: unknown
          grid_id: string | null
          ind_0_3: number | null
          ind_11_17: number | null
          ind_18_24: number | null
          ind_25_39: number | null
          ind_4_5: number | null
          ind_40_54: number | null
          ind_55_64: number | null
          ind_6_10: number | null
          ind_65_79: number | null
          ind_80p: number | null
          logements_1945_1970: number | null
          logements_1970_1990: number | null
          logements_apres_1990: number | null
          logements_avant_1945: number | null
          logements_inconnus: number | null
          logements_sociaux: number | null
          menages_1_personne: number | null
          menages_5_plus: number | null
          menages_collectif: number | null
          menages_maison: number | null
          menages_pauvres: number | null
          menages_proprietaires: number | null
          menages_total: number | null
          nb_carreaux: number | null
          population_inconnue: number | null
          population_totale: number | null
          revenu_median: number | null
          surface_moyenne: number | null
        }
        Relationships: []
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      admin_get_custom_geo_stats: { Args: never; Returns: Json }
      admin_list_custom_geo_zones: {
        Args: { p_org_id?: string; p_search?: string; p_source_type?: string }
        Returns: Json
      }
      aggregate_campaign_metric: {
        Args: {
          p_campaign_id: string
          p_is_core: boolean
          p_metric_field: string
        }
        Returns: number
      }
      aggregate_dsp_by_custom_zone: {
        Args: {
          p_campaign_id: string
          p_metric?: string
          p_pop_field?: string
          p_zone_id: string
        }
        Returns: Json
      }
      alignement_dispersion_cp: {
        Args: { p_campaign_id: string; p_parent?: string; p_tolerance?: number }
        Returns: Json
      }
      alignement_par_maille: {
        Args: {
          p_campaign_id: string
          p_limite?: number
          p_maille?: string
          p_parent?: string
          p_tolerance?: number
        }
        Returns: Json
      }
      alignement_par_maille_geo: {
        Args: {
          p_bbox_xmax?: number
          p_bbox_xmin?: number
          p_bbox_ymax?: number
          p_bbox_ymin?: number
          p_campaign_id: string
          p_limite?: number
          p_maille?: string
          p_parent?: string
          p_tolerance?: number
          p_variable_code?: string
        }
        Returns: Json
      }
      apply_zone_weights_to_strategy: {
        Args: { p_in_weights: Json; p_out_weights: Json; p_strategy_id: string }
        Returns: number
      }
      archive_and_purge_radio: { Args: never; Returns: Json }
      build_ref_codes_postaux: { Args: never; Returns: undefined }
      calculer_alignement_geo: {
        Args: { p_campaign_id: string; p_poids?: number; p_tolerance?: number }
        Returns: Json
      }
      calculer_score_composite: {
        Args: {
          p_codes_postaux: string[]
          p_indicateurs: string[]
          p_poids: number[]
          p_sens: string[]
        }
        Returns: {
          n_indicateurs: number
          postal_code: string
          score: number
        }[]
      }
      calculer_score_composite_jsonb: {
        Args: {
          p_codes_postaux: string[]
          p_indicateurs: string[]
          p_poids: number[]
          p_sens: string[]
        }
        Returns: Json
      }
      check_iso_hits_new_carreaux: {
        Args: { p_iso_geojson: string; p_since: string }
        Returns: boolean
      }
      classe_carreau_risque: {
        Args: {
          p_bas: number[]
          p_d_bas: number
          p_d_haut: number
          p_haut: number[]
          p_inclure_pprt: boolean
          p_pprt_niveau: string
        }
        Returns: string
      }
      classe_iris: { Args: { p_colonne: string }; Returns: string }
      classer_lot_risque: {
        Args: {
          p_bas: number[]
          p_cas: Json
          p_haut: number[]
          p_inclure_pprt: boolean
        }
        Returns: string[]
      }
      classer_territoires: {
        Args: {
          p_indicateur: string
          p_limite?: number
          p_palier?: string
          p_plancher_population?: number
          p_regrouper_arrondissements?: boolean
          p_tri?: string
        }
        Returns: {
          classe: string
          code: string
          nom: string
          part: number
          population: number
          valeur: number
        }[]
      }
      clip_geojson_to_france: { Args: { p_fc: Json }; Returns: Json }
      clip_rings_to_france: { Args: { p_rings: Json }; Returns: Json }
      codes_postaux_dans_bbox: {
        Args: { p_est: number; p_nord: number; p_ouest: number; p_sud: number }
        Returns: {
          code_postal: string
        }[]
      }
      codes_postaux_du_perimetre: {
        Args: { p_code: string; p_type: string }
        Returns: {
          code_postal: string
        }[]
      }
      codes_postaux_du_perimetre_jsonb: {
        Args: { p_code: string; p_type: string }
        Returns: Json
      }
      compte_cp_campagne: { Args: { p_campaign_id: string }; Returns: number }
      compte_poi_par_categorie: {
        Args: {
          p_categories: string[]
          p_champ: string
          p_sources?: string[]
          p_valeur: string
        }
        Returns: {
          categorie: string
          nb: number
        }[]
      }
      compter_sites_rayon: {
        Args: {
          p_gravites?: string[]
          p_natures?: string[]
          p_perim_codes?: string[]
          p_perim_niveau?: string
        }
        Returns: Json
      }
      compute_filosofi_national_averages: { Args: never; Returns: Json }
      compute_filosofi_profiles_batch: {
        Args: { p_entries: Json; p_secret_stat?: number }
        Returns: Json
      }
      compute_filosofi_profiles_batch_2km: {
        Args: { p_entries: Json; p_secret_stat?: number }
        Returns: Json
      }
      compute_iris_poi_counts_category: {
        Args: { p_categorie: string }
        Returns: number
      }
      compute_zone_audience_stats: {
        Args: { p_caller_user_id?: string; p_zone_id: string }
        Returns: Json
      }
      compute_zone_items_audience: {
        Args: { p_caller_user_id?: string; p_zone_id: string }
        Returns: Json
      }
      consolider_geo_icpe: { Args: never; Returns: Json }
      consommer_quota: {
        Args: { p_cle: string; p_fenetre_s: number; p_max: number }
        Returns: Json
      }
      construire_carreau_risque_distance: {
        Args: {
          p_bande: number
          p_bande_id?: number
          p_lon_est?: number
          p_lon_ouest?: number
          p_n_bandes?: number
          p_rayon_max_m?: number
        }
        Returns: Json
      }
      construire_couverture_rayon: {
        Args: {
          p_bande: number
          p_bande_id?: number
          p_lon_est?: number
          p_lon_ouest?: number
          p_n_bandes?: number
          p_rayon_max_m?: number
        }
        Returns: Json
      }
      construire_iris_agg: {
        Args: { p_niveau: string }
        Returns: {
          duree_ms: number
          lignes: number
          niveau: string
        }[]
      }
      construire_iris_bornes: {
        Args: never
        Returns: {
          colonnes: number
          duree_ms: number
        }[]
      }
      construire_zones_risque: {
        Args: { p_code: string; p_profil: Json }
        Returns: Json
      }
      correlation_campagne_indicateur: {
        Args: { p_campaign_id: string; p_indicator_code: string }
        Returns: Json
      }
      count_emetteurs_par_radio: {
        Args: never
        Returns: {
          nb: number
          radio_id: string
        }[]
      }
      count_poi_by_categorie_source: {
        Args: { p_categorie: string; p_source?: string }
        Returns: number
      }
      create_carreaux_table: {
        Args: { table_name: string }
        Returns: undefined
      }
      create_custom_geo_zone: {
        Args: {
          p_description: string
          p_geometry_geojson: string
          p_name: string
          p_org_id: string
          p_source_metadata: Json
          p_source_type: string
        }
        Returns: string
      }
      create_custom_geo_zone_with_subzones: {
        Args: {
          p_description: string
          p_geometry_geojson: string
          p_name: string
          p_org_id: string
          p_source_metadata: Json
          p_source_type: string
          p_subzones?: Json
        }
        Returns: string
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      diffusion_par_classe: {
        Args: {
          p_campagne: string
          p_cible?: string
          p_limite?: number
          p_maille?: string
          p_parent?: string
          p_profil: Json
        }
        Returns: Json
      }
      disablelongtransactions: { Args: never; Returns: string }
      drop_carreaux_table: { Args: { table_name: string }; Returns: undefined }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      empreinte_zones: { Args: { p_zone_ids: string[] }; Returns: Json }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      etat_indicateur_cp: { Args: { p_indicator_code: string }; Returns: Json }
      export_carreaux_after: {
        Args: { p_last_idcar: string; p_limit: number }
        Returns: {
          familles_monoparentales: number
          geom_json: string
          idcar: string
          ind_0_3: number
          ind_11_17: number
          ind_18_24: number
          ind_25_39: number
          ind_4_5: number
          ind_40_54: number
          ind_55_64: number
          ind_6_10: number
          ind_65_79: number
          ind_80p: number
          logements_1945_1970: number
          logements_1970_1990: number
          logements_apres_1990: number
          logements_avant_1945: number
          logements_inconnus: number
          logements_sociaux: number
          menages_1_personne: number
          menages_5_plus: number
          menages_collectif: number
          menages_maison: number
          menages_pauvres: number
          menages_proprietaires: number
          menages_total: number
          population_inconnue: number
          population_totale: number
          revenu_median: number
          surface_moyenne: number
        }[]
      }
      export_carreaux_batch: {
        Args: { p_limit: number; p_offset: number }
        Returns: {
          familles_monoparentales: number
          geom_json: string
          idcar: string
          ind_0_3: number
          ind_11_17: number
          ind_18_24: number
          ind_25_39: number
          ind_4_5: number
          ind_40_54: number
          ind_55_64: number
          ind_6_10: number
          ind_65_79: number
          ind_80p: number
          logements_1945_1970: number
          logements_1970_1990: number
          logements_apres_1990: number
          logements_avant_1945: number
          logements_inconnus: number
          logements_sociaux: number
          menages_1_personne: number
          menages_5_plus: number
          menages_collectif: number
          menages_maison: number
          menages_pauvres: number
          menages_proprietaires: number
          menages_total: number
          population_inconnue: number
          population_totale: number
          revenu_median: number
          surface_moyenne: number
        }[]
      }
      export_iris_after: {
        Args: { p_last_code_iris?: string; p_limit?: number }
        Returns: {
          code_iris: string
          densite_pop: number
          geom_json: string
          indice_gini: number
          indice_jeunesse: number
          is_true_iris: boolean
          nb_csp_cadre: number
          nb_csp_employe: number
          nb_csp_ouvrier: number
          nb_diplome_aucun: number
          nb_diplome_bac: number
          nb_diplome_sup: number
          nb_emplois: number
          nb_emplois_commune: number
          nb_menages: number
          nom_iris: string
          part_actifs_marche_velo: number
          part_actifs_transport_commun: number
          part_appartements: number
          part_couples_avec_enfants: number
          part_familles_monoparentales: number
          part_femmes_actives: number
          part_hommes_actifs: number
          part_logements_sociaux: number
          part_menages_emmenages_2ans: number
          part_pop_65_plus: number
          part_pop_etrangere: number
          part_pop_moins_18: number
          part_residences_principales: number
          part_sans_diplome: number
          pop_0_14: number
          pop_15_29: number
          pop_30_44: number
          pop_45_59: number
          pop_60_74: number
          pop_75_plus: number
          population: number
          rev_d1: number
          rev_d9: number
          rev_median: number
          taux_chomage: number
          taux_diplome_sup: number
          taux_emploi: number
          taux_pauvrete: number
          taux_proprio: number
          type_iris: string
        }[]
      }
      export_iris_batch: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          code_iris: string
          geometry: string
          nb_csp_cadre: number
          nb_csp_employe: number
          nb_csp_ouvrier: number
          nom_iris: string
          pop_0_14: number
          pop_15_29: number
          pop_30_44: number
          pop_45_59: number
          pop_60_74: number
          pop_75_plus: number
          population: number
          type_iris: string
        }[]
      }
      fill_carreaux_1km_bande: {
        Args: { p_x0: number; p_x1: number }
        Returns: {
          etat: string
          mailles: number
          ms: number
          sources: number
        }[]
      }
      fraicheur_sources: {
        Args: { p_inclure_lourd?: boolean; p_sources: Json }
        Returns: Json
      }
      geo_alignment_baseline: {
        Args: {
          p_denominator: string
          p_min_population?: number
          p_target_cols: string[]
        }
        Returns: {
          sum_denom: number
          sum_target: number
        }[]
      }
      geo_alignment_match_postals: {
        Args: {
          p_denominator: string
          p_postal_codes: string[]
          p_target_cols: string[]
        }
        Returns: {
          code_commune: string
          code_iris: string
          denom_value: number
          is_true_iris: boolean
          nom_commune: string
          postal_code: string
          share: number
          target_value: number
        }[]
      }
      geo_alignment_numeric_columns: {
        Args: never
        Returns: {
          column_name: string
          data_type: string
        }[]
      }
      geomatik_fill_holes: { Args: { g: unknown }; Returns: unknown }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_active_data_registry: {
        Args: never
        Returns: {
          category: string
          description: string
          label: string
          metadata: Json
          slug: string
        }[]
      }
      get_admin_filter_geometry: {
        Args: { p_codes: string[]; p_scale: string }
        Returns: Json
      }
      get_battle_geometry: { Args: { p_cache_keys: string[] }; Returns: Json }
      get_campaign_actors: { Args: { p_campaign_id: string }; Returns: Json }
      get_campaign_available_metrics: {
        Args: { p_campaign_id: string }
        Returns: {
          field: string
          has_data: boolean
        }[]
      }
      get_campaign_expected: {
        Args: { p_campaign_id: string }
        Returns: number
      }
      get_campaign_impressions: {
        Args: {
          p_bbox?: number[]
          p_campaign_id: string
          p_full?: boolean
          p_scale?: string
        }
        Returns: {
          code_dept: string
          code_iris: string
          geom: unknown
          impressions: number
          nom_commune: string
        }[]
      }
      get_campaign_last_data_dates: {
        Args: { p_ids: string[] }
        Returns: {
          campaign_id: string
          last_data_date: string
        }[]
      }
      get_campaign_medias: { Args: { p_campaign_id: string }; Returns: Json }
      get_campaign_pacing: {
        Args: {
          p_campaign_id: string
          p_metric_field: string
          p_version?: number
        }
        Returns: Json
      }
      get_campaign_reconciliation: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      get_campaign_reconciliation_map: {
        Args: {
          p_bbox_xmax?: number
          p_bbox_xmin?: number
          p_bbox_ymax?: number
          p_bbox_ymin?: number
          p_campaign_id: string
          p_metric?: string
        }
        Returns: Json
      }
      get_campaign_stats_by_field: {
        Args: { p_campaign_id: string; p_field: string }
        Returns: Json
      }
      get_campaign_suivi: {
        Args: { p_actors?: string[]; p_campaign_id: string }
        Returns: Json
      }
      get_campaign_suivi_map: {
        Args: {
          p_actors?: string[]
          p_bbox_xmax?: number
          p_bbox_xmin?: number
          p_bbox_ymax?: number
          p_bbox_ymin?: number
          p_campaign_id: string
          p_metric?: string
        }
        Returns: Json
      }
      get_carreaux_bbox: {
        Args: {
          p_east: number
          p_limit?: number
          p_millesime?: string
          p_north: number
          p_resolution?: string
          p_south: number
          p_table: string
          p_west: number
        }
        Returns: {
          geom: unknown
          idcar: string
          metadata: Json
        }[]
      }
      get_carreaux_by_zoom: {
        Args: {
          bbox_east: number
          bbox_north: number
          bbox_south: number
          bbox_west: number
          indicateur?: string
          max_rows?: number
          zoom_level: number
        }
        Returns: {
          geojson: string
          id: string
          menages: number
          population: number
          value: number
        }[]
      }
      get_carreaux_capture_geometry: {
        Args: {
          p_admin_scope?: Json
          p_east: number
          p_indicateur?: string
          p_max_rows?: number
          p_north: number
          p_south: number
          p_value_max?: number
          p_value_min?: number
          p_west: number
          p_zoom_level?: number
        }
        Returns: Json
      }
      get_civic_layer_geojson: {
        Args: {
          p_max_lat: number
          p_max_lng: number
          p_min_lat: number
          p_min_lng: number
        }
        Returns: Json
      }
      get_cluster_geometry: {
        Args: { p_cluster_id: number; p_model_version: number }
        Returns: Json
      }
      get_composite_zone_geometry: {
        Args: { p_zone_ids: string[] }
        Returns: Json
      }
      get_custom_geo_zone_feature: {
        Args: { p_zone_id: string }
        Returns: Json
      }
      get_custom_geo_zones_stats: { Args: { p_org_id: string }; Returns: Json }
      get_dept_representative_communes: {
        Args: never
        Returns: {
          code_commune: string
          code_dept: string
          nom_dept: string
        }[]
      }
      get_digital_analysis_breakdown_v2: {
        Args: {
          p_aggregation?: string
          p_campaign_id: string
          p_indicator?: string
          p_limit?: number
          p_media?: string[]
          p_metric_field?: string
          p_parent_code?: string
          p_parent_type?: string
          p_pop_min?: number
        }
        Returns: Json
      }
      get_digital_available_indicators: { Args: never; Returns: Json }
      get_digital_campaign_bbox: {
        Args: { p_campaign_id: string }
        Returns: number[]
      }
      get_digital_campaigns_list: {
        Args: { p_organization_id?: string }
        Returns: Json
      }
      get_digital_geography_map_v2: {
        Args: {
          p_bbox_xmax?: number
          p_bbox_xmin?: number
          p_bbox_ymax?: number
          p_bbox_ymin?: number
          p_campaign_id: string
          p_media?: string[]
          p_metric_field?: string
          p_pop_field?: string
          p_scale?: string
        }
        Returns: Json
      }
      get_digital_media_heatmap_v2: {
        Args: {
          p_aggregation?: string
          p_campaign_id: string
          p_indicator?: string
          p_metric_field?: string
        }
        Returns: Json
      }
      get_digital_zone_geometry: {
        Args: { p_campaign_id: string; p_codes?: string[]; p_scale: string }
        Returns: Json
      }
      get_dsp_campaign_stats: {
        Args: never
        Returns: {
          campaign_id: string
          france_rows: number
          matched_iris: number
          total_rows: number
        }[]
      }
      get_filosofi_profile_for_isochrone: {
        Args: { p_iso_geojson: string; p_secret_stat?: number }
        Returns: Json
      }
      get_filosofi_secret_stat_diagnostic: {
        Args: { p_secret_stat?: number }
        Returns: Json
      }
      get_indicator_threshold_selection: {
        Args: {
          p_indicator_code: string
          p_operator: string
          p_preview?: boolean
          p_threshold: number
        }
        Returns: Json
      }
      get_iris_admin_stats: { Args: never; Returns: Json }
      get_iris_dept_geojson_by_bbox: {
        Args: {
          p_agg?: string
          p_colonne?: string
          p_east: number
          p_north: number
          p_simplify?: number
          p_south: number
          p_west: number
        }
        Returns: Json
      }
      get_iris_dept_stats: {
        Args: {
          p_colonne: string
          p_east?: number
          p_north?: number
          p_south?: number
          p_true_iris_only?: boolean
          p_west?: number
        }
        Returns: Json
      }
      get_iris_fill_status: {
        Args: never
        Returns: {
          col: string
          n: number
        }[]
      }
      get_iris_metric_columns: {
        Args: never
        Returns: {
          key: string
        }[]
      }
      get_iris_selection_geometry: {
        Args: { p_iris_codes: string[] }
        Returns: Json
      }
      get_iris_stats_by_bbox: {
        Args: {
          p_colonne: string
          p_east?: number
          p_north?: number
          p_south?: number
          p_true_iris_only?: boolean
          p_west?: number
        }
        Returns: Json
      }
      get_iris_tile: {
        Args: { x: number; y: number; z: number }
        Returns: string
      }
      get_isochrone_battle: { Args: { p_rings: Json }; Returns: Json }
      get_isochrone_battle_v10: { Args: { p_rings: Json }; Returns: Json }
      get_national_population_totals: { Args: never; Returns: Json }
      get_poi_categories: {
        Args: never
        Returns: {
          count: number
          icon: string
          key: string
          label: string
        }[]
      }
      get_poi_near_panneau: {
        Args: { p_categorie: string; p_panneau_id: string; p_rayon_m?: number }
        Returns: {
          distance_m: number
          nom: string
          poi_id: string
          sous_categorie: string
        }[]
      }
      get_radio_audit: { Args: never; Returns: Json }
      get_radio_coverage_geometry: {
        Args: { p_radio_id: string; p_transmitter_ids?: string[] }
        Returns: Json
      }
      get_radio_emetteurs_geojson:
        | {
            Args: {
              p_bbox?: string
              p_limit?: number
              p_radio_id?: string
              p_systeme?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_bbox?: string
              p_exclude_categories?: string[]
              p_limit?: number
              p_radio_id?: string
              p_radio_ids?: string[]
              p_systeme?: string
            }
            Returns: Json
          }
      get_radio_filter_options: { Args: never; Returns: Json }
      get_radio_stats: { Args: never; Returns: Json }
      get_radios_in_zone: {
        Args: { systeme_filter?: string; zone_geom: unknown }
        Returns: {
          audience_data: Json
          categorie_arcom: string
          genre: string
          groupe_media: string
          nb_emetteurs: number
          portee: string
          radio_id: string
          radio_nom: string
          tarifs_data: Json
        }[]
      }
      get_sources_stats: { Args: never; Returns: Json }
      get_strategy_comparison_data: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_strategy_id: string
        }
        Returns: {
          bid_multiplier: number
          clicks_real: number
          clicks_sim: number
          country_code: string
          date: string
          impressions_real: number
          impressions_sim: number
          leads_real: number
          leads_sim: number
          postal_code: string
          spend_real: number
          spend_sim: number
        }[]
      }
      get_table_sizes: {
        Args: never
        Returns: {
          indexes_size: string
          table_name: string
          table_size: string
          total_size: string
          total_size_bytes: number
        }[]
      }
      get_territory_mask_geometry: {
        Args: { p_codes: string[]; p_scale: string }
        Returns: Json
      }
      get_tile: { Args: { x: number; y: number; z: number }; Returns: string }
      get_tmja_by_bbox: {
        Args: {
          p_east: number
          p_limit?: number
          p_north: number
          p_south: number
          p_tolerance?: number
          p_west: number
        }
        Returns: Json
      }
      get_tmja_capture_geometry: {
        Args: {
          p_admin_scope?: Json
          p_buffer_meters?: number
          p_east: number
          p_limit?: number
          p_min_tmja?: number
          p_north: number
          p_south: number
          p_west: number
        }
        Returns: Json
      }
      get_tmja_tile: {
        Args: { p_min_tmja?: number; x: number; y: number; z: number }
        Returns: string
      }
      get_user_org: { Args: never; Returns: string }
      get_user_orgs: { Args: never; Returns: string[] }
      get_user_role: { Args: never; Returns: string }
      get_voronoi_by_category:
        | { Args: { cat_name: string }; Returns: Json[] }
        | {
            Args: {
              cat_name: string
              filtre_departement?: string
              filtre_region?: string
              filtre_ville?: string
              metropolitaine?: boolean
            }
            Returns: Json[]
          }
      get_voronoi_capture_geometry: {
        Args: {
          p_category: string
          p_filtre_departement?: string
          p_filtre_region?: string
          p_filtre_ville?: string
          p_metropolitaine?: boolean
        }
        Returns: Json
      }
      get_voronoi_routier_by_category: {
        Args: {
          cache_key_120?: string
          cache_key_30?: string
          cache_key_60?: string
          cache_key_90?: string
          cat_name: string
          filtre_departement?: string
          filtre_region?: string
          filtre_ville?: string
          metropolitaine?: boolean
        }
        Returns: Json[]
      }
      get_zone_bbox_array: { Args: { p_zone_id: string }; Returns: number[] }
      get_zone_centroids: {
        Args: { p_scale: string }
        Returns: {
          code: string
          lat: number
          lon: number
          nom: string
        }[]
      }
      get_zone_items_export: {
        Args: { p_caller_user_id?: string; p_zone_id: string }
        Returns: Json
      }
      get_zone_polygons: { Args: { p_scale: string }; Returns: Json }
      get_zone_radius_targets: {
        Args: { p_zone_id: string }
        Returns: {
          area_km2: number
          lat: number
          lng: number
          radius_km: number
        }[]
      }
      gettransactionid: { Args: never; Returns: unknown }
      import_carreaux_batch: {
        Args: {
          p_geom_wkts: string[]
          p_idcars: string[]
          p_metadatas: Json[]
          p_millesimes: string[]
          p_resolutions: string[]
        }
        Returns: number
      }
      import_iris_batch: { Args: { batch: Json }; Returns: number }
      infer_tier: { Args: { p_postal_code: string }; Returns: string }
      insert_subzone_from_geojson: {
        Args: {
          p_default_multiplier?: number
          p_geometry_geojson: string
          p_name: string
          p_ordering?: number
          p_source_ref: string
          p_zone_id: string
        }
        Returns: string
      }
      interpolate_on_curve: {
        Args: { p_curve: Json; p_x: number }
        Returns: number
      }
      lire_couverture_rayon: {
        Args: {
          p_cible?: string
          p_gravites?: string[]
          p_natures?: string[]
          p_perim_codes?: string[]
          p_perim_niveau?: string
        }
        Returns: Json
      }
      list_custom_geo_source_types: {
        Args: { p_org_id: string }
        Returns: Json
      }
      log_smart_prompt_feedback: {
        Args: {
          p_agent?: string
          p_confidence?: number
          p_error_msg?: string
          p_message: string
          p_params?: Json
          p_success?: boolean
        }
        Returns: number
      }
      log_strategy_change: {
        Args: {
          p_change_type: string
          p_field_path?: string
          p_new_value?: Json
          p_old_value?: Json
          p_reason?: string
          p_strategy_id: string
          p_triggered_by?: string
        }
        Returns: string
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      match_campaign_postal_to_iris: {
        Args: { p_campaign_id: string }
        Returns: number
      }
      materialiser_indicateur_cp: {
        Args: { p_indicator_code: string }
        Returns: Json
      }
      materialize_indicator_cp_values: {
        Args: { p_indicator_code: string }
        Returns: number
      }
      merge_iris_indicators_batch: { Args: { p_rows: Json }; Returns: number }
      notify_pgrst_reload: { Args: never; Returns: undefined }
      panneaux_near_point: {
        Args: {
          p_lat: number
          p_limit?: number
          p_lng: number
          p_rayon_m?: number
        }
        Returns: {
          distance_m: number
          id: string
          lat: number
          lng: number
          nb_lycees_500m: number
          regie: string
          score_age_15_29: number
          type_panneau: string
          ville: string
        }[]
      }
      poi_count_by_categorie: {
        Args: never
        Returns: {
          categorie: string
          nb: number
        }[]
      }
      populate_carreaux_columns: {
        Args: { p_batch_size?: number }
        Returns: number
      }
      populate_geom_3857_batch: { Args: { n?: number }; Returns: number }
      populate_geom_centroid_async: { Args: never; Returns: string }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      population_exposee_agregee: {
        Args: {
          p_cible?: string
          p_dimension?: string
          p_forcer_rayon?: boolean
          p_gravites?: string[]
          p_limite?: number
          p_modes?: string[]
          p_natures?: string[]
          p_perim_codes?: string[]
          p_perim_niveau?: string
          p_rayon_m?: number
        }
        Returns: Json
      }
      population_exposee_site: { Args: { p_site_id: string }; Returns: Json }
      population_par_classe: {
        Args: {
          p_cible?: string
          p_limite?: number
          p_maille?: string
          p_parent?: string
          p_profil: Json
        }
        Returns: Json
      }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      pprt_consolider_departement: { Args: never; Returns: Json }
      pprt_importer_partition: {
        Args: { p_lignes: Json; p_partition: string }
        Returns: Json
      }
      pprt_niveaux: {
        Args: never
        Returns: {
          geom_3857: unknown
          niveau: string
          pprt_id: string
        }[]
      }
      pprt_perimetres_carte: {
        Args: { p_bbox: number[]; p_limite?: number; p_types?: string[] }
        Returns: Json
      }
      publier_strategie: {
        Args: {
          p_charge_utile: Json
          p_empreinte: Json
          p_publiee_par: string
          p_strategie_id: string
        }
        Returns: Json
      }
      purge_old_agent_chat_messages: { Args: never; Returns: number }
      qualite_colonnes_iris: { Args: never; Returns: Json }
      qualite_fraicheur: { Args: never; Returns: Json }
      qualite_indicateurs: { Args: never; Returns: Json }
      qualite_invariants: { Args: never; Returns: Json }
      rayon_defaut_exposition: { Args: never; Returns: number }
      refresh_campaign_rollups: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      refresh_filosofi_national_averages: { Args: never; Returns: string }
      refresh_smart_ville_stats: { Args: never; Returns: number }
      refresh_ville_stats_chunk: {
        Args: { p_limit: number; p_offset: number }
        Returns: number
      }
      releve_empreinte_carreaux: { Args: never; Returns: Json }
      remplir_code_postal_carreau: { Args: { p_lot?: number }; Returns: Json }
      remplir_cp_population_totale: {
        Args: {
          p_bande: number
          p_lon_est?: number
          p_lon_ouest?: number
          p_n_bandes?: number
        }
        Returns: Json
      }
      remplir_pprt_niveau_generateur: { Args: never; Returns: Json }
      repair_iso_cache_geoms: { Args: never; Returns: Json }
      resolve_custom_geo_zone_codes:
        | { Args: { p_zone_id: string }; Returns: Json }
        | {
            Args: { p_caller_user_id: string; p_zone_id: string }
            Returns: Json
          }
      resolve_custom_geo_zone_codes_with_subzones: {
        Args: { p_caller_user_id?: string; p_zone_id: string }
        Returns: Json
      }
      risques_industriels_carte: {
        Args: {
          p_bbox?: number[]
          p_gravites?: string[]
          p_inclure_inactifs?: boolean
          p_limite?: number
          p_natures?: string[]
          p_rayon_m?: number
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      simulate_dsp_report: { Args: { p_campaign_id: string }; Returns: Json }
      sites_exposition: {
        Args: { p_depts?: string[]; p_gravites: string[]; p_natures?: string[] }
        Returns: {
          id: string
          lat: number
          lng: number
        }[]
      }
      smart_demographie_ranking: {
        Args: {
          p_indicateur?: string
          p_lat: number
          p_limit?: number
          p_lng: number
          p_rayon_km?: number
        }
        Returns: {
          carreau_id: string
          lat_centre: number
          lng_centre: number
          valeur: number
        }[]
      }
      smart_demographie_stats: {
        Args: {
          p_indicateur?: string
          p_lat: number
          p_lng: number
          p_rayon_km?: number
        }
        Returns: Json
      }
      smart_demographie_top_villes: {
        Args: { p_indicateur?: string; p_limit?: number; p_rayon_km?: number }
        Returns: {
          lat: number
          lng: number
          rang: number
          total: number
          ville: string
        }[]
      }
      smart_poi_nearby: {
        Args: {
          p_categorie?: string
          p_lat: number
          p_lng: number
          p_rayon_m?: number
        }
        Returns: {
          categorie: string
          distance_m: number
          id: string
          lat: number
          lng: number
          nom: string
          ville: string
        }[]
      }
      smart_poi_stats: {
        Args: { p_categorie: string; p_ville?: string }
        Returns: Json
      }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      transform_geometries_for_save: {
        Args: { p_geometries: Json; p_method: string }
        Returns: Json
      }
      truncate_laposte_hexasmal: { Args: never; Returns: undefined }
      unaccent: { Args: { "": string }; Returns: string }
      unlockrows: { Args: { "": string }; Returns: number }
      update_iris_core_batch: { Args: { p_rows: Json }; Returns: number }
      update_laposte_centroids: { Args: never; Returns: undefined }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      vider_carreau_risque_distance: { Args: never; Returns: Json }
      vider_couverture_rayon: { Args: never; Returns: number }
      vider_exposition_cache: { Args: { p_avant?: string }; Returns: number }
      vider_zones_risque: { Args: { p_avant?: string }; Returns: Json }
      zone_dessin: { Args: { p_geojson: Json }; Returns: Json }
      zone_difference: {
        Args: { p_base: string; p_retires: string[] }
        Returns: Json
      }
      zone_intersection: { Args: { p_zone_ids: string[] }; Returns: Json }
      zone_rayon: {
        Args: { p_lat: number; p_lon: number; p_rayon_m: number }
        Returns: Json
      }
      zones_risque_tuile: {
        Args: { p_profil_code: string; p_x: number; p_y: number; p_z: number }
        Returns: string
      }
    }
    Enums: {
      job_status: "pending" | "processing" | "completed" | "failed"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
      job_status: ["pending", "processing", "completed", "failed"],
    },
  },
} as const

