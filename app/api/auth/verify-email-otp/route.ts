import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const AUTH_CALLBACK = "/auth/callback";
const DEFAULT_NEXT = "/home";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, code, origin } = body as { email?: string; code?: string; origin?: string };

    if (!email || !code || typeof email !== "string" || typeof code !== "string") {
      return NextResponse.json(
        { error: "Email and code are required" },
        { status: 400 }
      );
    }

    const cleanCode = code.trim().replace(/\s/g, "");
    if (!/^\d{6}$/.test(cleanCode)) {
      return NextResponse.json(
        { error: "Please enter the 6-digit code from your email" },
        { status: 400 }
      );
    }

    const emailNorm = email.trim().toLowerCase();

    const { data: row, error: selectError } = await supabaseAdmin
      .from("email_verification_codes")
      .select("user_id, code, expires_at")
      .eq("email", emailNorm)
      .single();

    if (selectError || !row) {
      return NextResponse.json(
        { error: "Invalid or expired code. Request a new one." },
        { status: 400 }
      );
    }

    if (row.code !== cleanCode) {
      return NextResponse.json(
        { error: "Invalid code. Check the 6-digit number and try again." },
        { status: 400 }
      );
    }

    if (new Date(row.expires_at) <= new Date()) {
      await supabaseAdmin.from("email_verification_codes").delete().eq("email", emailNorm);
      return NextResponse.json(
        { error: "Code has expired. Request a new one." },
        { status: 400 }
      );
    }

    let userId = row.user_id as string | null;
    if (!userId) {
      const { data: id } = await supabaseAdmin.rpc("get_auth_user_id_by_email", {
        p_email: emailNorm,
      });
      userId = id as string | null;
    }
    if (!userId) {
      return NextResponse.json(
        { error: "User not found. Please sign up again." },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });
    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to verify email" },
        { status: 500 }
      );
    }

    await supabaseAdmin.from("email_verification_codes").delete().eq("email", emailNorm);

    // Prefer the origin the user is on (e.g. localhost when developing) so the magic-link
    // redirect goes back to the same host. Fall back to NEXT_PUBLIC_SITE_URL or x-forwarded-host.
    const hasValidOrigin =
      typeof origin === "string" &&
      /^https?:\/\/[^/]+$/.test(origin.trim());
    const baseUrl = hasValidOrigin
      ? origin.trim()
      : process.env.NEXT_PUBLIC_SITE_URL ||
        (req.headers.get("x-forwarded-host")
          ? `https://${req.headers.get("x-forwarded-host")}`
          : "http://localhost:3000");
    const redirectTo = `${baseUrl}${AUTH_CALLBACK}?next=${encodeURIComponent(DEFAULT_NEXT)}`;

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: emailNorm,
      options: { redirectTo },
    });

    if (linkError || !linkData?.properties?.action_link) {
      return NextResponse.json(
        { signInRequired: true, message: "Email verified. Please sign in with your password." },
        { status: 200 }
      );
    }

    return NextResponse.json({
      redirectUrl: linkData.properties.action_link,
    });
  } catch (e) {
    console.error("[verify-email-otp]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
