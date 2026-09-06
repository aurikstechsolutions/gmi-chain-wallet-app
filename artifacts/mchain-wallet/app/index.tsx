import { Redirect } from "expo-router";
import { useWallet } from "@/context/WalletContext";

export default function Index() {
  const { isOnboarded } = useWallet();
  return <Redirect href={isOnboarded ? "/(tabs)" : "/onboarding"} />;
}
