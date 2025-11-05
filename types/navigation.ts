export type RootStackParamList = {
  HomeScreen: undefined;
  MakeQueueScreen: { id: string } | undefined;
  JoinQueueScreen: { id: string; code?: string } | undefined;
  HostQueueScreen: {
    code: string;
    sessionId: string;
    wsUrl: string;
    joinUrl?: string;
    hostAuthToken?: string;
    eventName?: string;
    maxGuests?: number;
  };
};
