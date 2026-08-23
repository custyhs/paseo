import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CheckpointStorage } from "./checkpoint";

export const draftCheckpointStorage: CheckpointStorage = AsyncStorage;
