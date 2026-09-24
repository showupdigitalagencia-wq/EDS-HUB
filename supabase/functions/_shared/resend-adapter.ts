// =============================================================================
// Resend Adapter — Server-side only
// =============================================================================
// Isolates Resend API calls so business logic doesn't depend on the SDK.
// =============================================================================

export interface SendEmailAttachment {
  filename: string;
  content: string; // base64 encoded string
  contentType?: string;
}

interface SendEmailParams {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  idempotencyKey: string;
  headers?: Record<string, string>;
  attachments?: SendEmailAttachment[];
}

interface SendEmailResult {
  success: boolean;
  messageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    return {
      success: false,
      messageId: null,
      errorCode: 'CONFIG_ERROR',
      errorMessage: 'RESEND_API_KEY is not configured',
    };
  }

  try {
    const payload: any = {
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    };

    if (params.text) {
      payload.text = params.text;
    }

    if (params.replyTo) {
      payload.reply_to = params.replyTo;
    }

    if (params.headers && Object.keys(params.headers).length > 0) {
      payload.headers = params.headers;
    }

    if (params.attachments && params.attachments.length > 0) {
      payload.attachments = params.attachments.map((att) => ({
        filename: att.filename,
        content: att.content,
        content_type: att.contentType || 'application/pdf',
      }));
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // Do NOT include API key in error messages
      let parsedError: { message?: string; name?: string } = {};
      try {
        parsedError = JSON.parse(errorBody);
      } catch {
        // Not JSON, use raw text (but limit length)
      }

      return {
        success: false,
        messageId: null,
        errorCode: `HTTP_${response.status}`,
        errorMessage: parsedError.message || errorBody.substring(0, 200),
      };
    }

    const data = await response.json();
    return {
      success: true,
      messageId: data.id || null,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err) {
    // Do NOT log API key
    const message = err instanceof Error ? err.message : 'Unknown Resend error';
    return {
      success: false,
      messageId: null,
      errorCode: 'NETWORK_ERROR',
      errorMessage: message,
    };
  }
}
