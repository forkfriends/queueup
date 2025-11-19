export type RootStackParamList = {
  HomeScreen: undefined;
  MakeQueueScreen: { id: string } | undefined;
  JoinQueueScreen: { id: string; code?: string } | undefined;
  PrivacyPolicyScreen: undefined;
  HostQueueScreen: {
    code: string;
    sessionId: string;
    wsUrl: string;
    joinUrl?: string;
    hostAuthToken?: string;
    eventName?: string;
    maxGuests?: number;
    location?: string | null;
    contactInfo?: string | null;
    openTime?: string | null;
    closeTime?: string | null;
  };
  GuestQueueScreen: {
    code: string;
    partyId: string;
    sessionId?: string | null;
    initialPosition?: number;
    initialAheadCount?: number;
    initialQueueLength?: number | null;
    initialEtaMs?: number | null;
    guestName?: string;
    partySize?: number;
  };
};
