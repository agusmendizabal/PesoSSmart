/**
 * transcribe — Convierte audio a texto usando Groq Whisper
 *
 * Recibe: { audio_base64: string, mime_type?: string }
 * Devuelve: { text: string }
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROQ_API_KEY  = Deno.env.get('GROQ_API_KEY')!;
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  // Verificar JWT
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (error || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  const { audio_base64, mime_type = 'audio/m4a' } = await req.json() as {
    audio_base64: string;
    mime_type?: string;
  };

  if (!audio_base64) {
    return new Response(JSON.stringify({ error: 'audio_base64 requerido' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Decodificar base64 → Uint8Array
  const binary   = atob(audio_base64);
  const bytes    = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // Enviar a Groq Whisper
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime_type }), 'audio.m4a');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'es');
  form.append('response_format', 'json');

  const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body:    form,
  });

  if (!groqRes.ok) {
    console.error('[transcribe] Groq error:', await groqRes.text());
    return new Response(
      JSON.stringify({ error: 'Error de transcripción' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const { text } = await groqRes.json();
  return new Response(
    JSON.stringify({ text: text?.trim() ?? '' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
