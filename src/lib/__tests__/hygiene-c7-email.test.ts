/**
 * Cluster 7 pins — F-M14 transactional email templates.
 *
 * Org- and user-controlled values (org name, inviter name, customer name,
 * order id, currency label) interpolated into HTML mail bodies must render
 * escaped; the plain-text bodies keep the raw values. Every pin FAILS on
 * pristine sandbox and PASSES on the fix branch.
 */

jest.mock("@topupsend/db", () => ({
  Integration: { findOne: jest.fn() },
}));

jest.mock(
  "@topupsend/db/connection",
  () => ({
    dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  }),
  { virtual: true },
);
jest.mock("../../../packages/db/src/connection", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
}));

import { EmailService } from "@/lib/services/email.service";

const sendSpy = jest
  .spyOn(EmailService, "sendEmail")
  .mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
});

function lastSentOptions() {
  expect(sendSpy).toHaveBeenCalledTimes(1);
  return sendSpy.mock.calls[0][1] as {
    to: string;
    subject: string;
    html: string;
    text?: string;
  };
}

describe("sendTeamInvitationEmail (F-M14)", () => {
  it("pin: inviter name, org name and temp password render escaped in HTML", async () => {
    const evilInviter = '<script>alert("inviter")</script>';
    const evilOrg = 'Acme <img src=x onerror="alert(1)"> & Sons';
    const evilPassword = '<b>not-bold</b>';

    await EmailService.sendTeamInvitationEmail(
      "orgA",
      "invitee@example.com",
      evilInviter,
      evilOrg,
      evilPassword,
    );

    const { html, text } = lastSentOptions();
    expect(html).not.toContain(evilInviter);
    expect(html).not.toContain(evilOrg);
    expect(html).not.toContain(evilPassword);
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;inviter&quot;)&lt;/script&gt;",
    );
    expect(html).toContain("Acme &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Sons");
    expect(html).toContain("&lt;b&gt;not-bold&lt;/b&gt;");
    // Plain-text body keeps the raw, readable values (control).
    expect(text).toContain(evilInviter);
    expect(text).toContain(evilOrg);
  });
});

describe("sendPasswordResetEmail (F-M14)", () => {
  it("pin: org name renders escaped in HTML", async () => {
    const evilOrg = 'Reset <svg onload="alert(1)"> Co';

    await EmailService.sendPasswordResetEmail(
      "orgA",
      "user@example.com",
      "deadbeefcafe",
      evilOrg,
    );

    const { html, text } = lastSentOptions();
    expect(html).not.toContain(evilOrg);
    expect(html).toContain("Reset &lt;svg onload=&quot;alert(1)&quot;&gt; Co");
    expect(text).toContain(evilOrg);
  });
});

describe("sendRefundNotificationEmail (F-M14)", () => {
  it("pin: customer name, order id, currency and org name render escaped in HTML", async () => {
    await EmailService.sendRefundNotificationEmail({
      orgId: "orgA",
      recipientEmail: "customer@example.com",
      customerName: '<script>alert("name")</script>',
      orgName: "Org <b>Inc</b>",
      orderId: 'ORD-<script>alert("order")</script>',
      refundAmount: 12.5,
      currency: "<script>USD</script>",
      newBalance: 100,
      loginUrl: "https://example.com/login",
    });

    const { html, text } = lastSentOptions();
    expect(html).not.toContain('<script>alert("name")</script>');
    expect(html).not.toContain('ORD-<script>alert("order")</script>');
    expect(html).not.toContain("<script>USD</script>");
    expect(html).not.toContain("Org <b>Inc</b>");
    expect(html).toContain(
      "Hello &lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;,",
    );
    expect(html).toContain(
      "ORD-&lt;script&gt;alert(&quot;order&quot;)&lt;/script&gt;",
    );
    expect(html).toContain("&lt;script&gt;USD&lt;/script&gt; 12.50");
    expect(html).toContain("Org &lt;b&gt;Inc&lt;/b&gt;");
    // Plain-text body keeps the raw values (control).
    expect(text).toContain('<script>alert("name")</script>');
  });
});
