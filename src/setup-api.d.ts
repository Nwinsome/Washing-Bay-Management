export {};

declare global {
  interface Window {
    setupApi: {
      getStatus: () => Promise<{ isComplete: boolean }>;
      complete: (input: {
        businessName: string;
        phone: string;
        address: string;
        fullName: string;
        username: string;
        password: string;
        logo?: {
          mimeType: string;
          bytes: Uint8Array;
        };
      }) => Promise<{ success: true }>;
    };
  }
}
