type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (_provider: "google" | "apple" | "microsoft", _opts?: SignInOptions) => ({
      redirected: false,
      error: new Error("Lovable authentication is disabled in Resonance Open Nova sovereign-local mode."),
    }),
  },
};
