import { useState } from "react";
import {
	Pressable,
	SafeAreaView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { StatusBar } from "expo-status-bar";

type Screen = "home" | "greeting";

export default function App() {
	const [screen, setScreen] = useState<Screen>("home");
	const [count, setCount] = useState(0);
	const [name, setName] = useState("");
	const [greeting, setGreeting] = useState<string | null>(null);

	return (
		<SafeAreaView style={styles.root}>
			<StatusBar style="dark" />
			{screen === "home" ? (
				<View style={styles.screen}>
					<Text style={styles.title} accessibilityRole="header">
						Yoqa Demo
					</Text>
					<Text style={styles.count} accessibilityLabel={`Count: ${count}`}>
						Count: {count}
					</Text>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Increment"
						style={styles.button}
						onPress={() => setCount((value) => value + 1)}
					>
						<Text style={styles.buttonLabel}>Increment</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Decrement"
						style={styles.button}
						onPress={() => setCount((value) => value - 1)}
					>
						<Text style={styles.buttonLabel}>Decrement</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Open greeting"
						style={styles.buttonSecondary}
						onPress={() => setScreen("greeting")}
					>
						<Text style={styles.buttonSecondaryLabel}>Open greeting</Text>
					</Pressable>
				</View>
			) : (
				<View style={styles.screen}>
					<Text style={styles.title} accessibilityRole="header">
						Greeting
					</Text>
					<TextInput
						accessibilityLabel="Name"
						autoCapitalize="none"
						autoCorrect={false}
						onChangeText={setName}
						placeholder="Name"
						style={styles.input}
						value={name}
					/>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Submit"
						style={styles.button}
						onPress={() => setGreeting(name.trim() ? `Hello, ${name.trim()}` : null)}
					>
						<Text style={styles.buttonLabel}>Submit</Text>
					</Pressable>
					{greeting ? <Text style={styles.greeting}>{greeting}</Text> : null}
				</View>
			)}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: "#ffffff",
	},
	screen: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 16,
		paddingHorizontal: 24,
	},
	title: {
		fontSize: 28,
		fontWeight: "700",
		color: "#111111",
	},
	count: {
		fontSize: 20,
		color: "#222222",
	},
	button: {
		minWidth: 220,
		paddingVertical: 14,
		paddingHorizontal: 20,
		borderRadius: 10,
		backgroundColor: "#111111",
		alignItems: "center",
	},
	buttonLabel: {
		color: "#ffffff",
		fontSize: 16,
		fontWeight: "600",
	},
	buttonSecondary: {
		minWidth: 220,
		paddingVertical: 14,
		paddingHorizontal: 20,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: "#111111",
		alignItems: "center",
	},
	buttonSecondaryLabel: {
		color: "#111111",
		fontSize: 16,
		fontWeight: "600",
	},
	input: {
		minWidth: 220,
		borderWidth: 1,
		borderColor: "#cccccc",
		borderRadius: 10,
		paddingVertical: 12,
		paddingHorizontal: 16,
		fontSize: 16,
	},
	greeting: {
		fontSize: 20,
		fontWeight: "600",
		color: "#111111",
	},
});
