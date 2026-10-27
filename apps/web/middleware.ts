import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/", "/new", "/t/"];
const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/reset-password"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("st_session");

  const isProtected = PROTECTED.some((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path)));
  if (!hasSession && isProtected) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && AUTH_PAGES.some((path) => pathname.startsWith(path))) {
    return NextResponse.redirect(new URL("/new", request.url));
  }

  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: [
    "/",
    "/new",
    "/t/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
  ],
};
