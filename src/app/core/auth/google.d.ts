interface CredentialResponse {
  credential: string;
  select_by?: string;
}

interface IdConfiguration {
  client_id: string;
  callback: (response: CredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GsiButtonConfig {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: number;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize(config: IdConfiguration): void;
        renderButton(parent: HTMLElement, options: GsiButtonConfig): void;
        prompt(): void;
        disableAutoSelect(): void;
      };
    };
  };
}
