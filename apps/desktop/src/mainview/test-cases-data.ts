export type CaseStatus = "passed" | "errored";

export type TestFlow = {
	id: string;
	instructions: string;
	expectedResult: string;
};

export type TestCase = {
	id: string;
	number: number;
	name: string;
	suite: string;
	created: string;
	lastRun: string;
	status: CaseStatus;
	tags: string[];
	creator: string;
	lastEdit: string;
	flows: TestFlow[];
};

export const MOCK_CASES: TestCase[] = [
	{
		id: "tc_login",
		number: 1,
		name: "Example paywall test case",
		suite: "core-auth",
		created: "Oct 24, 2023",
		lastRun: "2 mins ago",
		status: "passed",
		tags: ["paywall"],
		creator: "Alex Rivera",
		lastEdit: "Today, 10:45 AM",
		flows: [
			{
				id: "flow_1",
				instructions: "Go through onboarding and navigate to the paywall",
				expectedResult: "Products are displayed with prices in dollars",
			},
		],
	},
	{
		id: "tc_checkout",
		number: 2,
		name: "Checkout API Integration",
		suite: "ecommerce",
		created: "Nov 12, 2023",
		lastRun: "14 mins ago",
		status: "errored",
		tags: ["API", "Checkout", "P1"],
		creator: "Sam Chen",
		lastEdit: "Yesterday, 4:12 PM",
		flows: [
			{
				id: "flow_1",
				instructions: "Add an item to cart and complete checkout",
				expectedResult: "Order confirmation is shown with a valid order id",
			},
		],
	},
	{
		id: "tc_settings",
		number: 3,
		name: "User Settings Persistence",
		suite: "account",
		created: "Nov 15, 2023",
		lastRun: "1 hour ago",
		status: "passed",
		tags: ["Account", "Regression"],
		creator: "Jordan Lee",
		lastEdit: "Today, 9:02 AM",
		flows: [
			{
				id: "flow_1",
				instructions: "Change notification preferences and relaunch the app",
				expectedResult: "Previously selected preferences remain applied",
			},
		],
	},
	{
		id: "tc_search",
		number: 4,
		name: "Search Index Consistency",
		suite: "data-sync",
		created: "Dec 02, 2023",
		lastRun: "3 hours ago",
		status: "passed",
		tags: ["Search", "Data"],
		creator: "Alex Rivera",
		lastEdit: "Dec 18, 2023",
		flows: [
			{
				id: "flow_1",
				instructions: "Search for a recently indexed item",
				expectedResult: "The item appears in results within expected ranking",
			},
		],
	},
	{
		id: "tc_onboarding",
		number: 5,
		name: "Onboarding Carousel UI",
		suite: "growth",
		created: "Dec 05, 2023",
		lastRun: "Yesterday",
		status: "errored",
		tags: ["Growth", "UI", "P1"],
		creator: "Sam Chen",
		lastEdit: "Dec 19, 2023",
		flows: [
			{
				id: "flow_1",
				instructions: "Swipe through the onboarding carousel to the last slide",
				expectedResult: "CTA to continue is visible and tappable",
			},
		],
	},
];

export const TOTAL_CASES = 124;

export function getTestCase(caseId: string): TestCase | undefined {
	return MOCK_CASES.find((row) => row.id === caseId);
}
