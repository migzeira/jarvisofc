import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, MessageCircle, ArrowLeft } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else setSent(true);
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <MessageCircle className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-foreground">Hey Jarvis</span>
          </div>
          <CardTitle className="text-xl">Recuperar senha</CardTitle>
          <CardDescription>
            {sent ? "Verifique seu email para o link de recuperação." : "Digite seu email para receber o link de recuperação"}
          </CardDescription>
        </CardHeader>
        {!sent && (
          <form onSubmit={handleReset}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar link
              </Button>
            </CardFooter>
          </form>
        )}
        <div className="px-6 pb-6">
          <Link to="/login" className="text-sm text-primary underline underline-offset-4 inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" /> Voltar ao login
          </Link>
        </div>
      </Card>
    </main>
  );
}
