export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type TitleType = 'movie' | 'anime' | 'series';
export type UserTitleAction = 'liked' | 'to_watch' | 'rejected' | 'watched';
export type ListVisibility = 'private' | 'public' | 'followers';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string | null;
          display_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          is_public: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & {
          id: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      titles: {
        Row: {
          id: string;
          type: TitleType;
          name: string;
          description: string | null;
          release_year: number | null;
          duration: string | null;
          poster_url: string | null;
          rating: number | null;
          external_source: string | null;
          external_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['titles']['Row']> & {
          id: string;
          type: TitleType;
          name: string;
        };
        Update: Partial<Database['public']['Tables']['titles']['Row']>;
        Relationships: [];
      };
      genres: {
        Row: {
          id: string;
          name: string;
        };
        Insert: Partial<Database['public']['Tables']['genres']['Row']> & {
          name: string;
        };
        Update: Partial<Database['public']['Tables']['genres']['Row']>;
        Relationships: [];
      };
      title_genres: {
        Row: {
          title_id: string;
          genre_id: string;
        };
        Insert: Database['public']['Tables']['title_genres']['Row'];
        Update: Partial<Database['public']['Tables']['title_genres']['Row']>;
        Relationships: [];
      };
      user_title_actions: {
        Row: {
          id: string;
          user_id: string;
          title_id: string;
          action: UserTitleAction;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['user_title_actions']['Row']> & {
          user_id: string;
          title_id: string;
          action: UserTitleAction;
        };
        Update: Partial<Database['public']['Tables']['user_title_actions']['Row']>;
        Relationships: [];
      };
      user_lists: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          visibility: ListVisibility;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['user_lists']['Row']> & {
          user_id: string;
          name: string;
        };
        Update: Partial<Database['public']['Tables']['user_lists']['Row']>;
        Relationships: [];
      };
      user_list_items: {
        Row: {
          id: string;
          list_id: string;
          title_id: string;
          position: number;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['user_list_items']['Row']> & {
          list_id: string;
          title_id: string;
        };
        Update: Partial<Database['public']['Tables']['user_list_items']['Row']>;
        Relationships: [];
      };
      follows: {
        Row: {
          id: string;
          follower_id: string;
          followed_id: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['follows']['Row']> & {
          follower_id: string;
          followed_id: string;
        };
        Update: Partial<Database['public']['Tables']['follows']['Row']>;
        Relationships: [];
      };
      recommendations: {
        Row: {
          id: string;
          user_id: string;
          title_id: string;
          score: number;
          reason: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['recommendations']['Row']> & {
          user_id: string;
          title_id: string;
          score: number;
        };
        Update: Partial<Database['public']['Tables']['recommendations']['Row']>;
        Relationships: [];
      };
    };
    Views: {
      titles_with_genres: {
        Row: Database['public']['Tables']['titles']['Row'] & {
          genres: string[];
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: {
      title_type: TitleType;
      user_title_action: UserTitleAction;
      list_visibility: ListVisibility;
    };
  };
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}
