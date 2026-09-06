declare module "react-native-nfc-manager" {
  export interface NdefRecord {
    tnf: number;
    type: number[];
    id: number[];
    payload: number[];
  }

  export interface NfcTag {
    ndefMessage?: NdefRecord[];
    id?: number[];
    techTypes?: string[];
  }

  export interface NfcManagerType {
    start(): Promise<void>;
    stop(): Promise<void>;
    isSupported(): Promise<boolean>;
    isEnabled(): Promise<boolean>;
    requestTechnology(tech: string): Promise<void>;
    cancelTechnologyRequest(): Promise<void>;
    getTag(): Promise<NfcTag | null>;
    ndefHandler: {
      writeNdefMessage(bytes: number[]): Promise<void>;
    };
  }

  export interface NdefType {
    encodeMessage(records: number[][]): number[] | undefined;
    textRecord(text: string, lang?: string): number[];
    text: {
      decodePayload(payload: Uint8Array): string;
    };
  }

  export const Ndef: NdefType;
  const NfcManager: NfcManagerType;
  export default NfcManager;
}
