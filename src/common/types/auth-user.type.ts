export type AuthUser = {
	sub: string;
	externalSubject?: string;
	identityProvider: 'clerk' | 'supabase';
	email?: string;
	role?: string;
	appMetadata?: Record<string, unknown>;
	userMetadata?: Record<string, unknown>;
};
