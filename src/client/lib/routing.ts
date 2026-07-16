import type { AppRoute } from "./types";

export function readRoute(): AppRoute {
  const url = new URL(window.location.href);

  if (url.pathname === "/admin" || url.pathname === "/admin/users" || url.pathname === "/users") {
    return { page: "admin", tab: "users" };
  }

  if (url.pathname === "/admin/settings" || url.pathname === "/settings") {
    return { page: "admin", tab: "settings" };
  }

  if (url.pathname === "/requests") {
    return { page: "requests" };
  }

  if (url.pathname === "/search") {
    const query = url.searchParams.get("query")?.trim() ?? "";
    if (query) {
      return { page: "search", query };
    }
  }

  return { page: "home" };
}

export function routePath(route: AppRoute): string {
  if (route.page === "admin") {
    return `/admin/${route.tab}`;
  }

  if (route.page === "search") {
    const params = new URLSearchParams({
      query: route.query,
    });
    return `/search?${params}`;
  }

  if (route.page === "requests") {
    return "/requests";
  }

  return "/";
}
