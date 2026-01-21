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
    const {
      email,
      password,
      username,
      firstName,
      lastName,
      phone,
    } = body as {
      email?: string;
      password?: string;
      username?: string;
      firstName?: string;
      lastName?: string;
      phone?: string | null;
    };

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: false,
      user_metadata: {
        username: username ?? null,
        first_name: firstName ?? null,
        last_name: lastName ?? null,
        phone: phone ?? null,
      },
    });

    if (createError) {
      const msg = createError.message || "";
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
        return NextResponse.json(
          { error: "Email already in use. Please sign in or use a different email." },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    const userId = createData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    const code = generate6DigitCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { error: upsertError } = await supabaseAdmin
      .from("email_verification_codes")
      .upsert(
        { email: email.trim().toLowerCase(), code, expires_at: expiresAt, user_id: userId },
        { onConflict: "email" }
      );

    if (upsertError) {
      const msg = upsertError.message || "Failed to store verification code";
      return NextResponse.json(
        { error: process.env.NODE_ENV === "development" ? `Failed to store verification code: ${msg}` : "Failed to store verification code" },
        { status: 500 }
      );
    }

    const { ok, error: sendError } = await sendVerificationCodeEmail(
      email.trim().toLowerCase(),
      code
    );
    if (!ok) {
      return NextResponse.json(
        { error: sendError || "Failed to send verification email. Check RESEND_API_KEY and RESEND_FROM_EMAIL." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, email: email.trim().toLowerCase() });
  } catch (e) {
    console.error("[signup-with-otp]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: process.env.NODE_ENV === "development" ? msg : "Something went wrong" },
      { status: 500 }
    );
  }
}
