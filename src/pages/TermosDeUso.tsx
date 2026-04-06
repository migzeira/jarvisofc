import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import logoEscrita from "@/assets/logo_escrita.png";

export default function TermosDeUso() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-[#03030a]/90 backdrop-blur-2xl border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/">
            <img src={logoEscrita} alt="Minha Maya" className="h-7 w-auto" />
          </Link>
          <Link to="/" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-extrabold mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Termos de Uso</h1>
        <p className="text-sm text-gray-500 mb-10">Última atualização: 06 de abril de 2026</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300 leading-relaxed">
          <section>
            <h2 className="text-lg font-bold text-white">1. Aceitação dos Termos</h2>
            <p>Ao acessar ou usar os serviços da Minha Maya ("Serviço"), você concorda em cumprir estes Termos de Uso. Se não concordar, não use o Serviço. O uso continuado após alterações constitui aceitação dos termos atualizados.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">2. Descrição do Serviço</h2>
            <p>A Minha Maya é um assistente pessoal baseado em inteligência artificial que funciona via WhatsApp. O Serviço permite gerenciar finanças, agenda, lembretes, anotações e integrações com ferramentas como Google Calendar, Google Sheets e Notion.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">3. Cadastro e Conta</h2>
            <p>Para utilizar o Serviço, você deve criar uma conta fornecendo informações verdadeiras e completas. Você é responsável por manter a confidencialidade de suas credenciais de acesso e por todas as atividades realizadas em sua conta.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">4. Planos e Pagamentos</h2>
            <p>O Serviço é oferecido mediante assinatura paga. Os valores e condições estão descritos na página de planos. Os pagamentos são processados pela plataforma Kirvano. Você pode cancelar sua assinatura a qualquer momento, sem fidelidade ou multa.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">5. Uso Aceitável</h2>
            <p>Você concorda em não utilizar o Serviço para:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Atividades ilegais ou fraudulentas</li>
              <li>Envio de spam ou mensagens em massa</li>
              <li>Tentativas de acesso não autorizado ao sistema</li>
              <li>Compartilhamento de conteúdo ofensivo, difamatório ou que viole direitos de terceiros</li>
              <li>Engenharia reversa ou tentativa de extrair código-fonte</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">6. Propriedade Intelectual</h2>
            <p>Todo o conteúdo, software, design e marcas relacionados ao Serviço são propriedade da MayaHub e protegidos por leis de propriedade intelectual. Você não pode copiar, modificar, distribuir ou criar obras derivadas sem autorização expressa.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">7. Limitação de Responsabilidade</h2>
            <p>O Serviço é fornecido "como está". A Minha Maya não garante disponibilidade ininterrupta e não se responsabiliza por perdas decorrentes de falhas técnicas, erros de IA, indisponibilidade temporária ou uso inadequado do Serviço.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">8. Integração com Terceiros</h2>
            <p>O Serviço se integra com plataformas de terceiros (WhatsApp, Google, Notion). Não nos responsabilizamos por alterações, indisponibilidade ou políticas dessas plataformas. O uso dessas integrações está sujeito aos termos de cada plataforma.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">9. Rescisão</h2>
            <p>Podemos suspender ou encerrar sua conta em caso de violação destes Termos. Você pode encerrar sua conta a qualquer momento entrando em contato com o suporte.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">10. Alterações nos Termos</h2>
            <p>Reservamo-nos o direito de alterar estes Termos a qualquer momento. Alterações significativas serão notificadas por email ou pelo próprio Serviço. O uso continuado após notificação constitui aceitação.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">11. Legislação e Foro</h2>
            <p>Estes Termos são regidos pelas leis da República Federativa do Brasil. Para dirimir qualquer controvérsia, fica eleito o foro da Comarca de São Paulo/SP.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">12. Contato</h2>
            <p>Em caso de dúvidas sobre estes Termos, entre em contato pelo email: <a href="mailto:suporte@minhamaya.com.br" className="text-violet-400 hover:text-violet-300">suporte@minhamaya.com.br</a></p>
          </section>
        </div>
      </main>
    </div>
  );
}
