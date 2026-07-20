export type CaseStatus = "passed" | "errored";

export type TestCase = {
	id: string;
	name: string;
	suite: string;
	created: string;
	lastRun: string;
	status: CaseStatus;
	tags: string[];
	creator: string;
	lastEdit: string;
};

export const MOCK_CASES: TestCase[] = [
	{
		id: "tc_login",
		name: "Login Flow Validation",
		suite: "core-auth",
		created: "Oct 24, 2023",
		lastRun: "2 mins ago",
		status: "passed",
		tags: ["Auth", "Regression", "P0"],
		creator: "Alex Rivera",
		lastEdit: "Today, 10:45 AM",
	},
	{
		id: "tc_checkout",
		name: "Checkout API Integration",
		suite: "ecommerce",
		created: "Nov 12, 2023",
		lastRun: "14 mins ago",
		status: "errored",
		tags: ["API", "Checkout", "P1"],
		creator: "Sam Chen",
		lastEdit: "Yesterday, 4:12 PM",
	},
	{
		id: "tc_settings",
		name: "User Settings Persistence",
		suite: "account",
		created: "Nov 15, 2023",
		lastRun: "1 hour ago",
		status: "passed",
		tags: ["Account", "Regression"],
		creator: "Jordan Lee",
		lastEdit: "Today, 9:02 AM",
	},
	{
		id: "tc_search",
		name: "Search Index Consistency",
		suite: "data-sync",
		created: "Dec 02, 2023",
		lastRun: "3 hours ago",
		status: "passed",
		tags: ["Search", "Data"],
		creator: "Alex Rivera",
		lastEdit: "Dec 18, 2023",
	},
	{
		id: "tc_onboarding",
		name: "Onboarding Carousel UI",
		suite: "growth",
		created: "Dec 05, 2023",
		lastRun: "Yesterday",
		status: "errored",
		tags: ["Growth", "UI", "P1"],
		creator: "Sam Chen",
		lastEdit: "Dec 19, 2023",
	},
];

export const TOTAL_CASES = 124;

export function getTestCase(caseId: string): TestCase | undefined {
	return MOCK_CASES.find((row) => row.id === caseId);
}
