export interface Client {
  id: string;
  user_id: string;
  name: string;
  url: string;
  plan_tier: string;
  status: string;
  stripe_customer_id: string;
  hubspot_portal_id: string;
  bland_phone_number: string;
  created_at: string;
}

export interface BrandProfile {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface RagChunk {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface Lead {
  id: string;
  client_id: string;
  email: string;
  name: string;
  company: string;
  linkedin_url: string;
  phone: string;
  phone_consent: boolean;
  apollo_id: string;
  enrichment_json: any;
  bos_lead_score: number;
  status: string;
  source: string;
  created_at: string;
}

export interface Campaign {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface AgentRun {
  id: string;
  client_id: string;
  campaign_id: string;
  agent_type: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  quality_score: number;
  output_summary: string;
  created_at: string;
}

export interface ApiUsage {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface ContentCalendar {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface Booking {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface CallTranscript {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface Invoice {
  id: string;
  client_id: string;
  contact_id: string;
  stripe_invoice_id: string;
  amount_cents: number;
  status: string;
  days_overdue: number;
  chase_step: number;
  last_chase_at: string;
  paid_at: string | null;
  created_at: string;
}

export interface Review {
  id: string;
  client_id: string;
  platform: string;
  external_review_id: string;
  star_rating: number;
  review_text: string;
  reviewer_name: string;
  review_date: string;
  responded: boolean;
  response_text: string;
  sentiment_score: number;
  created_at: string;
}

export interface WeeklyBrief {
  id: string;
  client_id: string;
  week_start: string;
  ware_score: number;
  brief_html: string;
  key_metrics_json: any;
  sent_at: string;
}

export interface ApprovalsQueue {
  id: string;
  client_id: string;
  action_type: string;
  payload_json: any;
  status: string;
  created_at: string;
  expires_at: string;
}
