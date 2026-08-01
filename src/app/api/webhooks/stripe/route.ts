import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  if (webhookSecret) {
    try {
      event = stripe.webhooks.constructEvent(body, signature!, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  } else {
    // For local dev without webhook secret
    event = JSON.parse(body);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created': {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;
        
        // Find client
        const { data: client } = await supabase
          .from('clients')
          .select('id, email')
          .eq('stripe_customer_id', customerId)
          .single();

        if (client) {
          // Update client tier and status
          await supabase
            .from('clients')
            .update({ 
              plan_tier: subscription.metadata.plan_tier || 'active_tier',
              status: 'active'
            })
            .eq('id', client.id);

          // Trigger n8n Strategist first-run
          if (process.env.N8N_WEBHOOK_BASE_URL) {
            fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/strategist-init`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: client.id })
            }).catch(e => console.error('n8n error:', e));
          }

          // Send welcome email via Resend
          if (process.env.RESEND_API_KEY && client.email) {
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: 'Business OS <welcome@businessos.ai>',
                to: client.email,
                subject: 'Welcome to Business OS - Your AI Operations Team',
                html: '<p>Welcome! We are extracting your data and spinning up your AI agents.</p>'
              })
            }).catch(e => console.error('Resend error:', e));
          }
        }
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;

        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (client) {
          await supabase.from('clients').update({ status: 'cancelled' }).eq('id', client.id);
          
          if (process.env.N8N_WEBHOOK_BASE_URL) {
            fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/deactivate-campaigns`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: client.id })
            }).catch(e => console.error('n8n error:', e));
          }
        }
        break;
      }
      
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer as string;

        const { data: client } = await supabase
          .from('clients')
          .select('id, email')
          .eq('stripe_customer_id', customerId)
          .single();

        if (client && process.env.RESEND_API_KEY && client.email) {
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'Business OS Billing <billing@businessos.ai>',
              to: client.email,
              subject: 'Action Required: Payment Failed',
              html: '<p>Your recent payment failed. Please update your payment method to keep your AI agents running.</p>'
            })
          }).catch(e => console.error('Resend error:', e));
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer as string;

        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (client) {
          await supabase.from('api_usage').insert({
            client_id: client.id,
            billing_event: 'invoice.payment_succeeded',
            amount: invoice.amount_paid,
            created_at: new Date().toISOString()
          });
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('Webhook error:', err.message);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
