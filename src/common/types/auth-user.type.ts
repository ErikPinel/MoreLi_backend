export type AuthUser = {
	sub: string;
	email?: string;
	role?: string;
	appMetadata?: Record<string, unknown>;
	userMetadata?: Record<string, unknown>;
};
