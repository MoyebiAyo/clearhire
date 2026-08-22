import { AuthConfirmed } from "@/components/auth-confirmed";

export const metadata = { title: "Email confirmed" };

export default async function AuthConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  return <AuthConfirmed invalid={status === "invalid"} />;
}
