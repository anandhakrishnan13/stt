import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const store = await cookies();
  redirect(store.has("st_session") ? "/dashboard" : "/login");
}
