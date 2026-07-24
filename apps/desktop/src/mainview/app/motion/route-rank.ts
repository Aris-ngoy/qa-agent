export type ViewTransitionType = "fade" | "slide-left" | "slide-right" | "push" | "pop";

type RouteRank = {
	section: number;
	depth: number;
};

function routeRank(pathname: string): RouteRank {
	if (pathname === "/" || pathname === "") {
		return { section: 0, depth: 0 };
	}
	if (pathname === "/status" || pathname.startsWith("/status/")) {
		return { section: 1, depth: 0 };
	}
	if (pathname === "/test-cases") {
		return { section: 2, depth: 0 };
	}
	if (pathname.startsWith("/test-cases/")) {
		return { section: 2, depth: 1 };
	}
	if (pathname === "/runs") {
		return { section: 3, depth: 0 };
	}
	if (pathname.startsWith("/runs/")) {
		return { section: 3, depth: 1 };
	}
	if (pathname === "/configuration" || pathname.startsWith("/configuration/")) {
		return { section: 4, depth: 0 };
	}
	return { section: 1, depth: 0 };
}

export function viewTransitionTypes(args: {
	fromPathname: string | undefined;
	toPathname: string;
}): ViewTransitionType[] {
	const { fromPathname, toPathname } = args;
	if (!fromPathname || fromPathname === toPathname) {
		return ["fade"];
	}

	const from = routeRank(fromPathname);
	const to = routeRank(toPathname);

	if (from.section === 0 || to.section === 0) {
		return ["fade"];
	}

	if (from.section === to.section) {
		if (from.depth < to.depth) return ["push"];
		if (from.depth > to.depth) return ["pop"];
		return ["fade"];
	}

	return to.section > from.section ? ["slide-left"] : ["slide-right"];
}
