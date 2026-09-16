// =============================================================================
// Twilio Adapter — Server-side only
// =============================================================================
// Isolates Twilio API calls so business logic doesn't depend on the SDK.
// Uses Twilio REST API directly via fetch.
// =============================================================================

interface SendSmsParams {
  to: string;   // E.164 format
  body: string;
}

interface SendSmsResult {
  success: boolean;
  messageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

  if (!accountSid || !authToken) {
    return {
      success: false,
      messageId: null,
      errorCode: 'CONFIG_ERROR',
      errorMessage: 'Twilio credentials are not configured',
    };
  }

  if (!fromNumber) {
    return {
      success: false,
      messageId: null,
      errorCode: 'MISSING_FROM_NUMBER',
      errorMessage: 'TWILIO_FROM_NUMBER is not configured',
    };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const body = new URLSearchParams({
      To: params.to,
      From: fromNumber,
      Body: params.body,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok || data.status === 'failed') {
      // Do NOT include auth credentials in error messages
      return {
        success: false,
        messageId: null,
        errorCode: String(data.code || `HTTP_${response.status}`),
        errorMessage: data.message || 'Twilio API error',
      };
    }

    return {
      success: true,
      messageId: data.sid || null,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err) {
    // Do NOT log auth credentials
    const message = err instanceof Error ? err.message : 'Unknown Twilio error';
    return {
      success: false,
      messageId: null,
      errorCode: 'NETWORK_ERROR',
      errorMessage: message,
    };
  }
}
