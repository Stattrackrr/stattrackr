import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendVerificationCodeEmail } from "@/lib/sendVerificationEmail";

const CODE_EXPIRY_MINUTES = 15;

function generate6DigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email } = body as { email?: string };

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const emailNorm = email.trim().toLowerCase();

    const { data: userId } = await supabaseAdmin.rpc("get_auth_user_id_by_email", {
      p_email: emailNorm,
    });
    if (!userId) {
      return NextResponse.json(
        { error: "No account found for this email. Please sign up first." },
        { status: 400 }
      );
    }

    const code = generate6DigitCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { error: upsertError } = await supabaseAdmin
      .from("email_verification_codes")
      .upsert(
        { email: emailNorm, code, expires_at: expiresAt, user_id: userId as string },
        { onConflict: "email" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: "Failed to store verification code" },
        { status: 500 }
      );
    }

    const { ok, error: sendError } = await sendVerificationCodeEmail(emailNorm, code);
    if (!ok) {
      return NextResponse.json(
        { error: sendError || "Failed to send verification email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[resend-email-otp]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
