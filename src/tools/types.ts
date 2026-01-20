export interface LinearTicket {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  url: string;
}

export interface LinearSearchResult {
  tickets: LinearTicket[];
  total: number;
}

export interface TicketSuggestion {
  title: string;
  description: string;
  suggestedBy: string;
  channelId: string;
  messageTs: string;
}
