
-- Admin can read all profiles
CREATE POLICY "Admin can read all profiles" ON public.profiles
  FOR SELECT USING (auth.email() = 'migueldrops@gmail.com');

-- Admin can read all conversations
CREATE POLICY "Admin can read all conversations" ON public.conversations
  FOR SELECT USING (auth.email() = 'migueldrops@gmail.com');

-- Admin can read all messages
CREATE POLICY "Admin can read all messages" ON public.messages
  FOR SELECT USING (auth.email() = 'migueldrops@gmail.com');

-- Admin can read all transactions
CREATE POLICY "Admin can read all transactions" ON public.transactions
  FOR SELECT USING (auth.email() = 'migueldrops@gmail.com');

-- Admin can read all agent_configs
CREATE POLICY "Admin can read all agent_configs" ON public.agent_configs
  FOR SELECT USING (auth.email() = 'migueldrops@gmail.com');

-- Admin can read all integrations
CREATE POLICY "Admin can read all integrations" ON public.integrations
  FOR SELECT USING (auth.email() = 'migueldrops@gmail.com');

-- Admin can read all events
CREATE POLICY "Admin can read all events" ON public.events
  FOR SELECT USING (auth.email() = 'migueldrops@gmail.com');

-- Admin can read all notes
CREATE POLICY "Admin can read all notes" ON public.notes
  FOR SELECT USING (auth.email() = 'migueldrops@gmail.com');
