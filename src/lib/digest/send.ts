/**
 * Email transport for digests (Resend). The client is injectable so tests
 * and `--preview` never touch the network.
 */
import { Resend } from "resend";
import { env } from "@/lib/env";

export type SendArgs = { from: string; to: string[]; subject: string; html: string; text: string; idempotencyKey: string };
export type SendResult = { id: string };

export interface EmailSender {
  send(args: SendArgs): Promise<SendResult>;
}

/** Minimal surface of the Resend client we depend on (see docs/plans/prototype/phase7 API notes). */
export type ResendLike = {
  emails: { send: Resend["emails"]["send"] };
};

export class ResendSender implements EmailSender {
  private readonly client: ResendLike;
  constructor(client?: ResendLike) {
    if (client) this.client = client;
    else {
      if (!env.resendApiKey) throw new Error("RESEND_API_KEY is not set");
      this.client = new Resend(env.resendApiKey);
    }
  }

  async send(args: SendArgs): Promise<SendResult> {
    const { data, error } = await this.client.emails.send(
      { from: args.from, to: args.to, subject: args.subject, html: args.html, text: args.text },
      { headers: { "Idempotency-Key": args.idempotencyKey } },
    );
    if (error || !data) throw new Error(`Resend: ${error?.name ?? "unknown"}: ${error?.message ?? "no data returned"}`);
    return { id: data.id };
  }
}

/** Records what would have been sent; used by tests and dry runs. */
export class FakeSender implements EmailSender {
  readonly sent: SendArgs[] = [];
  constructor(private readonly fail?: string) {}
  async send(args: SendArgs): Promise<SendResult> {
    if (this.fail) throw new Error(this.fail);
    this.sent.push(args);
    return { id: `fake-${this.sent.length}` };
  }
}
