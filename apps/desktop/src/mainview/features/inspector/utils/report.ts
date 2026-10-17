import { toast } from "@heroui/react";

export function notify(message: string) {
	toast.success(message);
}
