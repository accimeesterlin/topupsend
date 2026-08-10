import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
import { Integration } from '@topupsend/db';
import sgMail from '@sendgrid/mail';
import Mailgun from 'mailgun.js';
import formData from 'form-data';
import mailchimp from '@mailchimp/mailchimp_transactional';
// @ts-expect-error - zeptomail package has types but doesn't export them properly
import { SendMailClient } from 'zeptomail';

// POST - Test integration connection
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { provider, credentials, environment, testEmail } = body;

    console.log('Testing integration:', { provider, hasCredentials: !!credentials, environment, testEmail });

    if (!provider || !credentials) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    await dbConnection.connect();

    // Test connection based on provider
    let testResult;
    try {
      if (provider === 'dingconnect') {
        testResult = await testDingConnect(credentials, environment);
      } else if (provider === 'reloadly') {
        testResult = await testReloadly(credentials, environment);
      } else if (provider === 'zeptomail') {
        testResult = await testZeptoMail(credentials, testEmail);
      } else if (provider === 'mailgun') {
        testResult = await testMailgun(credentials, testEmail);
      } else if (provider === 'sendgrid') {
        testResult = await testSendGrid(credentials, testEmail);
      } else if (provider === 'mailchimp') {
        testResult = await testMailchimp(credentials, testEmail);
      } else if (provider === 'zapier') {
        testResult = await testZapier(credentials);
      } else {
        return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
      }

      // Update integration metadata with test success
      await Integration.findOneAndUpdate(
        { orgId: session.orgId, provider },
        {
          $set: {
            'metadata.lastTestSuccess': new Date(),
            status: 'active',
          },
        }
      );

      return NextResponse.json({
        success: true,
        message: 'Connection successful',
        data: testResult,
      });
    } catch (testError: any) {
      // Extract error message properly
      let errorMessage = 'Connection test failed';

      console.error('Test error caught:', testError);

      if (testError instanceof Error) {
        errorMessage = testError.message;
      } else if (typeof testError === 'string') {
        errorMessage = testError;
      } else if (testError?.message) {
        errorMessage = testError.message;
      } else if (testError) {
        try {
          errorMessage = JSON.stringify(testError);
        } catch {
          errorMessage = String(testError);
        }
      }

      console.log('Extracted error message:', errorMessage);

      // Update integration metadata with test error
      await Integration.findOneAndUpdate(
        { orgId: session.orgId, provider },
        {
          $set: {
            'metadata.lastTestError': errorMessage,
            status: 'error',
          },
        }
      );

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Test integration error:', error);
    return NextResponse.json(
      { error: 'Failed to test integration' },
      { status: 500 }
    );
  }
}

// Test DingConnect connection
async function testDingConnect(credentials: any, _environment?: string) {
  const { DingConnectService } = await import('@/lib/services/dingconnect.service');

  const dingService = new DingConnectService({ apiKey: credentials.apiKey });
  const balanceData = await dingService.getBalance();

  return {
    balance: balanceData.AccountBalance,
    currency: balanceData.CurrencyCode,
  };
}

// Test Reloadly connection
async function testReloadly(credentials: any, environment: string) {
  const { ReloadlyService } = await import('@/lib/services/reloadly.service');

  const reloadlyService = new ReloadlyService({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    environment: environment as 'sandbox' | 'production',
  });

  const balanceData = await reloadlyService.getBalance();

  return {
    balance: balanceData.AccountBalance,
    currency: balanceData.CurrencyCode,
  };
}

// Test ZeptoMail connection
async function testZeptoMail(credentials: any, testEmail?: string) {
  if (!credentials.apiKey) {
    throw new Error('ZeptoMail API key is required');
  }

  if (!credentials.fromEmail) {
    throw new Error('From email is required');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(credentials.fromEmail)) {
    throw new Error('Invalid from email format');
  }

  // If testEmail is provided, send an actual test email
  if (testEmail) {
    try {
      // Trim the API key to remove any whitespace
      const apiKey = credentials.apiKey.trim();

      console.log('ZeptoMail test - API key length:', apiKey.length);
      console.log('ZeptoMail test - From email:', credentials.fromEmail);
      console.log('ZeptoMail test - Test email:', testEmail);

      // Initialize ZeptoMail client with API token
      const client = new SendMailClient({ url: 'api.zeptomail.com/', token: apiKey });

      // Send email using the official SDK
      const response = await client.sendMail({
        from: {
          address: credentials.fromEmail,
          name: credentials.fromName || 'Test Email',
        },
        to: [{
          email_address: {
            address: testEmail,
          },
        }],
        subject: 'ZeptoMail Integration Test',
        htmlbody: `
          <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h2 style="color: #667eea;">Test Email Successful!</h2>
              <p>Your ZeptoMail integration is working correctly.</p>
              <p>This is a test email sent from TopUpSend platform.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="color: #6b7280; font-size: 12px;">
                Sent at: ${new Date().toISOString()}
              </p>
            </body>
          </html>
        `,
        textbody: `Test Email Successful!\n\nYour ZeptoMail integration is working correctly.\n\nThis is a test email sent from TopUpSend platform.\n\nSent at: ${new Date().toISOString()}`,
      });

      console.log('ZeptoMail response:', response);

      return {
        success: true,
        fromEmail: credentials.fromEmail,
        testEmailSent: testEmail,
        message: `Test email sent successfully to ${testEmail}`,
      };
    } catch (error: any) {
      console.error('ZeptoMail test error:', error);
      throw new Error(`ZeptoMail error: ${error.message}`);
    }
  }

  // Otherwise just validate the format
  return {
    success: true,
    fromEmail: credentials.fromEmail,
    message: 'ZeptoMail credentials format validated successfully',
  };
}

// Test Mailgun connection
async function testMailgun(credentials: any, testEmail?: string) {
  try {
    const mailgun = new Mailgun(formData);
    const mg = mailgun.client({
      username: 'api',
      key: credentials.apiKey,
    });

    // If test email is provided, send a test email
    if (testEmail) {
      await mg.messages.create(credentials.domain, {
        from: `${credentials.fromName || 'Test Email'} <${credentials.fromEmail}>`,
        to: testEmail,
        subject: 'Mailgun Integration Test',
        text: `Test Email Successful!\n\nYour Mailgun integration is working correctly.\n\nThis is a test email sent from TopUpSend platform.\n\nSent at: ${new Date().toISOString()}`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h2 style="color: #667eea;">Test Email Successful!</h2>
              <p>Your Mailgun integration is working correctly.</p>
              <p>This is a test email sent from TopUpSend platform.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="color: #6b7280; font-size: 12px;">
                Sent at: ${new Date().toISOString()}
              </p>
            </body>
          </html>
        `,
      });

      return {
        success: true,
        domain: credentials.domain,
        fromEmail: credentials.fromEmail,
        testEmailSent: testEmail,
        message: `Test email sent successfully to ${testEmail}`,
      };
    }

    // Otherwise just validate the domain
    const _domain = await mg.domains.get(credentials.domain);

    return {
      success: true,
      domain: credentials.domain,
      fromEmail: credentials.fromEmail,
      message: 'Mailgun credentials verified successfully',
    };
  } catch (error: any) {
    throw new Error(error.message || 'Mailgun API error');
  }
}

// Test SendGrid connection
async function testSendGrid(credentials: any, testEmail?: string) {
  try {
    sgMail.setApiKey(credentials.apiKey);

    // If test email is provided, send a test email
    if (testEmail) {
      await sgMail.send({
        to: testEmail,
        from: {
          email: credentials.fromEmail,
          name: credentials.fromName || 'Test Email',
        },
        subject: 'SendGrid Integration Test',
        text: `Test Email Successful!\n\nYour SendGrid integration is working correctly.\n\nThis is a test email sent from TopUpSend platform.\n\nSent at: ${new Date().toISOString()}`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h2 style="color: #667eea;">Test Email Successful!</h2>
              <p>Your SendGrid integration is working correctly.</p>
              <p>This is a test email sent from TopUpSend platform.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="color: #6b7280; font-size: 12px;">
                Sent at: ${new Date().toISOString()}
              </p>
            </body>
          </html>
        `,
      });

      return {
        success: true,
        fromEmail: credentials.fromEmail,
        testEmailSent: testEmail,
        message: `Test email sent successfully to ${testEmail}`,
      };
    }

    // Otherwise just validate the API key
    const response = await fetch('https://api.sendgrid.com/v3/scopes', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('SendGrid API key is invalid');
    }

    return {
      success: true,
      fromEmail: credentials.fromEmail,
      message: 'SendGrid credentials verified successfully',
    };
  } catch (error: any) {
    const errorMessage = error.message || 'SendGrid API error';
    throw new Error(errorMessage);
  }
}

// Test Mailchimp connection
async function testMailchimp(credentials: any, testEmail?: string) {
  try {
    const mailchimpClient = mailchimp(credentials.apiKey);

    // If test email is provided, send a test email
    if (testEmail) {
      await mailchimpClient.messages.send({
        message: {
          from_email: credentials.fromEmail,
          from_name: credentials.fromName || 'Test Email',
          to: [{ email: testEmail }],
          subject: 'Mailchimp Integration Test',
          text: `Test Email Successful!\n\nYour Mailchimp integration is working correctly.\n\nThis is a test email sent from TopUpSend platform.\n\nSent at: ${new Date().toISOString()}`,
          html: `
            <html>
              <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #667eea;">Test Email Successful!</h2>
                <p>Your Mailchimp integration is working correctly.</p>
                <p>This is a test email sent from TopUpSend platform.</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <p style="color: #6b7280; font-size: 12px;">
                  Sent at: ${new Date().toISOString()}
                </p>
              </body>
            </html>
          `,
        },
      });

      return {
        success: true,
        fromEmail: credentials.fromEmail,
        testEmailSent: testEmail,
        message: `Test email sent successfully to ${testEmail}`,
      };
    }

    // Otherwise just ping the API
    const _response = await mailchimpClient.users.ping();

    return {
      success: true,
      fromEmail: credentials.fromEmail,
      message: 'Mailchimp credentials verified successfully',
    };
  } catch (error: any) {
    const errorMessage = error.response?.text || error.message || 'Mailchimp API error';
    throw new Error(errorMessage);
  }
}

// Test Zapier connection
async function testZapier(credentials: any) {
  // For Zapier webhook, we'll just validate the URL format and send a test payload
  const webhookUrl = credentials.apiKey; // The apiKey field stores the webhook URL

  if (!webhookUrl.startsWith('https://hooks.zapier.com/')) {
    throw new Error('Invalid Zapier webhook URL. Must start with https://hooks.zapier.com/');
  }

  // Send a test payload to verify the webhook is active
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      test: true,
      message: 'Test webhook from TopUpSend',
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Zapier webhook error: ${response.status} - ${response.statusText}`);
  }

  return {
    success: true,
    webhookUrl,
    message: 'Zapier webhook verified successfully',
  };
}
