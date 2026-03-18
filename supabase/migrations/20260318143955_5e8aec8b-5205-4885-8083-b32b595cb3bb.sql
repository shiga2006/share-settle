
-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by authenticated users" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Groups table
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- Group members table
CREATE TABLE public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Security definer function to check group membership
CREATE OR REPLACE FUNCTION public.is_group_member(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE user_id = _user_id AND group_id = _group_id
  )
$$;

-- Groups RLS
CREATE POLICY "Members can view their groups" ON public.groups
FOR SELECT TO authenticated USING (public.is_group_member(auth.uid(), id));
CREATE POLICY "Authenticated users can create groups" ON public.groups
FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creator can update group" ON public.groups
FOR UPDATE TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Creator can delete group" ON public.groups
FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Group members RLS
CREATE POLICY "Members can view group members" ON public.group_members
FOR SELECT TO authenticated USING (public.is_group_member(auth.uid(), group_id));
CREATE POLICY "Members can add to their groups" ON public.group_members
FOR INSERT TO authenticated WITH CHECK (public.is_group_member(auth.uid(), group_id) OR auth.uid() = user_id);
CREATE POLICY "Members can remove themselves" ON public.group_members
FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Expenses table
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  split_type TEXT NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'custom')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view group expenses" ON public.expenses
FOR SELECT TO authenticated USING (public.is_group_member(auth.uid(), group_id));
CREATE POLICY "Members can add expenses" ON public.expenses
FOR INSERT TO authenticated WITH CHECK (public.is_group_member(auth.uid(), group_id));
CREATE POLICY "Payer can delete expense" ON public.expenses
FOR DELETE TO authenticated USING (auth.uid() = paid_by);

-- Expense splits table
CREATE TABLE public.expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  UNIQUE(expense_id, user_id)
);
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view splits" ON public.expense_splits
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.is_group_member(auth.uid(), e.group_id))
);
CREATE POLICY "Members can add splits" ON public.expense_splits
FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.is_group_member(auth.uid(), e.group_id))
);

-- Settlements table
CREATE TABLE public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  paid_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paid_to UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view settlements" ON public.settlements
FOR SELECT TO authenticated USING (public.is_group_member(auth.uid(), group_id));
CREATE POLICY "Members can add settlements" ON public.settlements
FOR INSERT TO authenticated WITH CHECK (public.is_group_member(auth.uid(), group_id) AND auth.uid() = paid_by);
