import type { TestCase, TestFlow } from "@/features/test-cases/utils/catalog-case";

export type GalleryImage = {
	id: string;
	name: string;
};

export type FormValues = {
	name: string;
	tags: string[];
	flows: TestFlow[];
	recordVideo: boolean;
	galleryImages: GalleryImage[];
	locale: string | null;
};

export const LOCALES = [
	{ id: "en-US", label: "English (United States)" },
	{ id: "en-GB", label: "English (United Kingdom)" },
	{ id: "fr-FR", label: "French (France)" },
	{ id: "de-DE", label: "German (Germany)" },
	{ id: "es-ES", label: "Spanish (Spain)" },
	{ id: "ja-JP", label: "Japanese (Japan)" },
	{ id: "pt-BR", label: "Portuguese (Brazil)" },
] as const;

export function formFromCase(testCase: TestCase): FormValues {
	return {
		name: testCase.name,
		tags: [...testCase.tags],
		flows: testCase.flows.map((flow) => ({ ...flow })),
		recordVideo: testCase.recordVideo,
		galleryImages: [],
		locale: null,
	};
}

export const emptyDefaults: FormValues = {
	name: "",
	tags: [],
	flows: [],
	recordVideo: false,
	galleryImages: [],
	locale: null,
};
