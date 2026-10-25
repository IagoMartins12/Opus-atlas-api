import type { Catalog } from '.';

/**
 * English. Keys are the Portuguese messages exactly as the code writes them;
 * `{n}` marks a value. `i18n.spec.ts` fails when a message the site can show
 * has no entry here.
 */
export const en: Catalog = {
  // Account and sign-in
  'A nova senha deve ser diferente da atual':
    'The new password must be different from the current one',
  'Conta não encontrada': 'Account not found',
  'Conta sem e-mail cadastrado': 'This account has no email',
  'E-mail não encontrado': 'Email not found',
  'E-mail ou senha incorretos': 'Incorrect email or password',
  'Email alterado com sucesso!': 'Email changed.',
  'Email confirmado com sucesso!': 'Email confirmed.',
  'Email já confirmado anteriormente': 'This email was already confirmed',
  'Email é obrigatório': 'Email is required',
  'Esta conta está vinculada ao Google. Use o login do Google.':
    'This account is linked to Google. Sign in with Google.',
  'Este e-mail já está em uso por outra conta':
    'This email is already used by another account',
  'Este e-mail já está sendo usado por outra conta.':
    'This email is already used by another account.',
  'Este já é o seu e-mail atual': 'This is already your email',
  'Identificação do Google incompleta': 'Incomplete Google identification',
  'Já existe uma conta com este e-mail':
    'An account with this email already exists',
  'Login com Google não configurado': 'Google sign-in is not set up',
  'Muitas tentativas de reset. Tente novamente em 1 hora.':
    'Too many reset attempts. Try again in an hour.',
  'Muitas tentativas. Aguarde 1 hora para solicitar novamente.':
    'Too many attempts. Wait an hour before asking again.',
  'Muitas tentativas. Tente novamente em 1 hora.':
    'Too many attempts. Try again in an hour.',
  'O Google não confirmou este e-mail': 'Google did not confirm this email',
  'O Google não devolveu a identificação':
    'Google did not return the identification',
  'Para alterar o e-mail, defina uma senha para sua conta primeiro':
    'To change your email, set a password for your account first',
  'Refresh token ausente': 'Missing refresh token',
  'Refresh token inválido ou expirado': 'Invalid or expired refresh token',
  'Senha alterada com sucesso! Você já pode fazer login com sua nova senha.':
    'Password changed. You can now sign in with your new password.',
  'Senha atual incorreta': 'Current password is incorrect',
  'Senha não atende aos critérios de segurança':
    'The password does not meet the security requirements',
  'Senhas não coincidem': 'Passwords do not match',
  'Token informado não é um refresh token':
    'The token given is not a refresh token',
  'Token inválido — e-mail não encontrado': 'Invalid token: email not found',
  'Usuário do refresh token não existe mais':
    'The refresh token’s user no longer exists',
  'Usuário não autenticado': 'Not signed in',
  'Usuário não encontrado': 'User not found',
  'Este link de confirmação já foi utilizado.':
    'This confirmation link was already used.',
  'Este link de reset já foi utilizado. Solicite um novo.':
    'This reset link was already used. Ask for a new one.',
  'Token expirado. Solicite um novo link de confirmação.':
    'Expired token. Ask for a new confirmation link.',
  'Token expirado. Solicite um novo reset de senha.':
    'Expired token. Ask for a new password reset.',
  'Token expirado. Solicite uma nova mudança de e-mail.':
    'Expired token. Ask for a new email change.',
  'Token inválido': 'Invalid token',
  'Token inválido.': 'Invalid token.',
  'Token expirado.': 'Expired token.',
  'Token já foi utilizado.': 'This token was already used.',
  'Usuário sem e-mail válido para autenticação':
    'This user has no valid email to sign in with',

  // Profile
  'Apenas um instrumento pode ser marcado como principal':
    'Only one instrument can be the main one',
  'Confirme sua senha atual para excluir a conta':
    'Confirm your current password to delete the account',
  'Nada para atualizar': 'Nothing to update',
  'O cadastro inicial já foi concluído. Use a atualização de perfil.':
    'Sign-up is already complete. Update your profile instead.',
  'Sua conta não tem perfil de aluno': 'Your account has no student profile',
  'Sua conta não tem perfil de professor':
    'Your account has no teacher profile',
  'include aceita, separados por vírgula: {0}':
    'include accepts, comma-separated: {0}',

  // Permissions and requests
  'Acesso negado': 'Access denied',
  'Erro interno do servidor': 'Internal server error',
  'Erro desconhecido': 'Unknown error',
  'A requisição excedeu o tempo limite do servidor':
    'The request took longer than the server allows',
  'Identificador inválido': 'Invalid identifier',
  'Já existe um registro com esse valor único ({0})':
    'A record with this unique value already exists ({0})',
  'Não autorizado': 'Not authorized',
  'Origem da requisição não informada': 'Request origin not given',
  'Origem da requisição não permitida': 'Request origin not allowed',
  'Referência inválida a um registro relacionado':
    'Invalid reference to a related record',
  'Registro não encontrado': 'Record not found',
  'Seu cadastro de professor ainda está em análise':
    'Your teacher sign-up is still under review',
  'Só administradores e professores editam o catálogo':
    'Only admins and teachers edit the catalog',
  'Você não tem permissão para acessar este recurso':
    'You do not have permission to access this',

  // Catalog
  'Biografia por IA indisponível no momento':
    'AI biographies are unavailable right now',
  'Biografia por IA indisponível: nenhum provedor configurado':
    'AI biographies are unavailable: no provider is set up',
  'Compositor com id "{0}" não encontrado': 'Composer with id "{0}" not found',
  'Compositor não encontrado': 'Composer not found',
  'Conquista não encontrada': 'Achievement not found',
  'Instrumento com id "{0}" não encontrado':
    'Instrument with id "{0}" not found',
  'Instrumento não encontrado': 'Instrument not found',
  'Limite diário de biografias geradas atingido. Tente amanhã.':
    'The daily limit of generated biographies was reached. Try tomorrow.',
  'Muitas biografias sendo geradas agora. Tente em instantes.':
    'Many biographies are being written right now. Try again shortly.',
  'Mídia já existe': 'This media already exists',
  'Nenhum campo de mídia para atualizar': 'No media field to update',
  'Nenhum compositor disponível para destaque':
    'No composer available to feature',
  'Obra com id "{0}" não encontrada': 'Work with id "{0}" not found',
  'Obra não encontrada': 'Work not found',
  'Obra sem página no IMSLP': 'This work has no IMSLP page',
  'Papel não encontrado': 'Role not found',
  'Partitura não encontrada': 'Score not found',
  'Professor não encontrado': 'Teacher not found',
  'Tipo de mídia inválido': 'Invalid media type',
  'Você não tem permissão para editar a mídia desta obra':
    'You do not have permission to edit this work’s media',
  'Época não encontrada': 'Era not found',
  'Anúncio não encontrado ou inativo': 'Ad not found or inactive',

  // Library: favorites, studies, annotations, collections
  'A coleção já é sua.': 'This collection is already yours.',
  'Algum item não existe no acervo ou é de outro tipo.':
    'Some item is not in the catalog or is of another kind.',
  'Anotação não encontrada': 'Annotation not found',
  'Anotação não encontrada ou sem permissão':
    'Annotation not found, or you have no permission',
  'Coleção não encontrada': 'Collection not found',
  'Confirme seu e-mail para criar coleções.':
    'Confirm your email to create collections.',
  'Dados da partitura são obrigatórios para adicionar':
    'Score details are required to add it',
  'Favorito não encontrado para atualizar': 'Favorite not found to update',
  'Item não encontrado na lista de aprendidas':
    'Item not found in the learned list',
  'Item não encontrado na lista de desejos': 'Item not found in the wish list',
  'Não é possível votar em anotação privada':
    'You cannot vote on a private annotation',
  'Não é possível votar na própria anotação':
    'You cannot vote on your own annotation',
  'Partitura não encontrada ou não pertence a esta obra':
    'Score not found, or not part of this work',
  'Só coleção pública vai para a home.':
    'Only public collections go to the home page.',
  'Troque o vídeo ou tire o vídeo, não os dois':
    'Replace the video or remove it, not both',
  'Um item aparece duas vezes na coleção.':
    'An item appears twice in the collection.',
  'Vídeo não encontrado, de outra conta ou com o envio não confirmado':
    'Video not found, from another account, or with its upload unconfirmed',
  'Você já tem {0} coleções. Apague uma para criar outra.':
    'You already have {0} collections. Delete one to create another.',
  'workId e scoreId são obrigatórios para check-favorite':
    'workId and scoreId are required for check-favorite',
  'workId é obrigatório para estatísticas': 'workId is required for stats',

  // Contributions and reports
  'A equipe analisou a sua denúncia e retirou o conteúdo. Obrigado por avisar.':
    'The team reviewed your report and removed the content. Thanks for letting us know.',
  'A equipe olhou com cuidado e o conteúdo continua no ar. Obrigado por avisar mesmo assim.':
    'The team looked carefully and the content stays up. Thanks for letting us know anyway.',
  'Confirme seu e-mail para contribuir com o acervo.':
    'Confirm your email to contribute to the catalog.',
  'Conte a curiosidade numa frase completa (pelo menos 20 caracteres).':
    'Tell the fact in a full sentence (at least 20 characters).',
  'Conteúdo denunciado não encontrado': 'Reported content not found',
  'Contribuição não encontrada': 'Contribution not found',
  'Curiosidade não encontrada': 'Fact not found',
  'Curiosidades são moderadas pela própria curiosidade.':
    'Facts are moderated through the fact itself.',
  'Denúncia não encontrada': 'Report not found',
  'Esta curiosidade já está na página.': 'This fact is already on the page.',
  'Esta denúncia já foi processada': 'This report was already handled',
  'Este campo não aceita contribuições.':
    'This field does not take contributions.',
  'O que você denunciou saiu do ar': 'What you reported was taken down',
  'O valor enviado é igual ao atual.':
    'The value sent is the same as the current one.',
  'Passaram sete dias sem denúncia, e o XP entrou na sua conta. Obrigado por completar o acervo.':
    'Seven days went by with no report, and the XP is in your account. Thanks for completing the catalog.',
  'Recebemos uma denúncia grave sobre um comentário seu, e ele saiu do ar enquanto a equipe analisa. Você será avisado do resultado.':
    'We received a serious report about one of your comments, and it is down while the team reviews it. You will hear about the outcome.',
  'Recebemos uma denúncia grave sobre um item que você enviou e ele saiu do catálogo enquanto a equipe analisa. Você será avisado do resultado.':
    'We received a serious report about an item you sent, and it left the catalog while the team reviews it. You will hear about the outcome.',
  'Recebemos uma denúncia grave sobre um item que você enviou. Ele continua no catálogo e a equipe vai analisar.':
    'We received a serious report about an item you sent. It stays in the catalog and the team will review it.',
  'Recebemos uma denúncia grave sobre uma anotação sua, e ela saiu do ar enquanto a equipe analisa. Você continua vendo a anotação e será avisado do resultado.':
    'We received a serious report about one of your annotations, and it is down while the team reviews it. You still see it, and you will hear about the outcome.',
  'Recebemos uma denúncia grave sobre uma coleção sua, e ela saiu do ar enquanto a equipe analisa. Você continua vendo a coleção e será avisado do resultado.':
    'We received a serious report about one of your collections, and it is down while the team reviews it. You still see it, and you will hear about the outcome.',
  'Recebemos uma denúncia grave sobre uma contribuição sua, e o texto anterior voltou enquanto a equipe analisa. Você será avisado do resultado.':
    'We received a serious report about one of your contributions, and the previous text is back while the team reviews it. You will hear about the outcome.',
  'Recebemos uma denúncia grave sobre uma curiosidade que você escreveu, e ela saiu do ar enquanto a equipe analisa. Você será avisado do resultado.':
    'We received a serious report about a fact you wrote, and it is down while the team reviews it. You will hear about the outcome.',
  'Remover conteúdo denunciado exige uma justificativa em `notes`.':
    'Removing reported content requires a reason in `notes`.',
  'Seu comentário saiu do ar para análise':
    'Your comment was taken down for review',
  'Seu envio foi contestado': 'Your upload was reported',
  'Seu envio saiu do catálogo para análise':
    'Your upload left the catalog for review',
  'Sua anotação saiu do ar para análise':
    'Your annotation was taken down for review',
  'Sua coleção saiu do ar para análise':
    'Your collection was taken down for review',
  'Sua contribuição foi desfeita para análise':
    'Your contribution was undone for review',
  'Sua contribuição rendeu {0} XP': 'Your contribution earned {0} XP',
  'Sua curiosidade saiu do ar para análise':
    'Your fact was taken down for review',
  'Sua denúncia foi analisada': 'Your report was reviewed',
  'Você chegou ao limite de denúncias para este item.':
    'You reached the report limit for this item.',
  'Você já denunciou este item por esse motivo, e a equipe já decidiu.':
    'You already reported this item for this reason, and the team has decided.',
  'Você já denunciou este item. Aguarde a análise.':
    'You already reported this item. Wait for the review.',

  // Uploads and files
  'Armazenamento de arquivos não configurado neste ambiente':
    'File storage is not set up in this environment',
  'Arquivo excede o limite de {0}MB': 'The file exceeds the {0}MB limit',
  'Arquivo excede o limite de {0}MB para {1}':
    'The file exceeds the {0}MB limit for {1}',
  'Arquivo não encontrado': 'File not found',
  'Arquivos do tipo {0} devem ser enviados através da API':
    'Files of type {0} must be sent through the API',
  'Arquivos do tipo {0} devem usar upload assinado direto':
    'Files of type {0} must use a direct signed upload',
  'Envie o arquivo ou o link da partitura, não os dois':
    'Send the score file or its link, not both',
  'Este arquivo já está associado a outro item':
    'This file is already linked to another item',
  'Falha ao enviar o arquivo': 'The file could not be sent',
  'Informe a URL, ou o título junto com o compositor':
    'Give the URL, or the title along with the composer',
  'Limite do plano {0} atingido ({1}/{2}). Faça upgrade para enviar mais arquivos.':
    'The {0} plan limit was reached ({1}/{2}). Upgrade to send more files.',
  'Nenhum arquivo enviado': 'No file sent',
  'Não foi possível identificar o tipo do arquivo':
    'The file type could not be identified',
  'O armazenamento não devolveu a URL da imagem':
    'Storage did not return the image URL',
  'O arquivo informado não é do tipo {0}': 'The file given is not of type {0}',
  'O arquivo não foi encontrado no armazenamento. Refaça o envio.':
    'The file was not found in storage. Upload it again.',
  'O arquivo não possui URL definitiva': 'The file has no final URL',
  'O envio do arquivo ainda não foi concluído':
    'The file upload has not finished yet',
  'Seu plano ({0}) permite {1} envios ao acervo (compositores, obras e partituras), e você já tem {2}. Assine um plano para enviar sem limite.':
    'Your plan ({0}) allows {1} catalog uploads (composers, works and scores), and you already have {2}. Subscribe to upload without limits.',
  'Tipo de arquivo inválido: {0}': 'Invalid file type: {0}',
  'Tipo de arquivo não aceito: {0}': 'File type not accepted: {0}',
  'Upload não encontrado': 'Upload not found',
  'Você só pode alterar compositores que você mesmo cadastrou':
    'You can only change composers you added yourself',
  'Você só pode alterar obras que você mesmo cadastrou':
    'You can only change works you added yourself',
  'Você só pode alterar partituras que você mesmo enviou':
    'You can only change scores you uploaded yourself',
  'Você só pode consultar o próprio histórico de contribuições':
    'You can only see your own contribution history',
  'scopeId deve conter apenas letras, números, hífen e sublinhado':
    'scopeId may only contain letters, digits, hyphens and underscores',
  'scopeId inválido': 'Invalid scopeId',

  // Billing
  'Assinatura gratuita criada com sucesso': 'Free subscription created.',
  'Assinatura já cancelada — o acesso continua até o fim do período pago':
    'Subscription already canceled: access lasts until the end of the paid period',
  'Assinatura reativada com sucesso!': 'Subscription reactivated.',
  'Assinatura cancelada com sucesso': 'Subscription canceled.',
  'Assinatura cancelada. Você terá acesso até {0}':
    'Subscription canceled. You keep access until {0}',
  'Conceda um plano pago': 'Grant a paid plan',
  'Período de teste de {0} dias iniciado!': '{0}-day trial started.',
  'Redirecionando para o checkout seguro...':
    'Redirecting to the secure checkout…',
  'Cupom aplicado! Você economizou {0}%': 'Coupon applied. You saved {0}%',
  'Esta contribuição já foi reprovada.':
    'This contribution was already rejected.',
  'Há uma cobrança em atraso. Regularize o pagamento antes de mudar de plano.':
    'There is an overdue charge. Settle the payment before changing plans.',
  'Plano {0} ativado. Cobramos só a diferença proporcional ao que faltava do ciclo.':
    'The {0} plan is active. We only charged the prorated difference for the rest of the cycle.',
  'Plano {0} ativado. O valor novo vale a partir da primeira cobrança.':
    'The {0} plan is active. The new price applies from the first charge.',
  'Downgrade agendado. Você continuará no plano {0} até o fim do ciclo atual.':
    'Downgrade scheduled. You stay on the {0} plan until the end of the current cycle.',
  'Nenhuma assinatura ativa encontrada': 'No active subscription found',
  'Nenhuma assinatura cancelada encontrada ou já expirou':
    'No canceled subscription found, or it already expired',
  'Nenhuma assinatura com Stripe ativa encontrada':
    'No active Stripe subscription found',
  'Nota fiscal não encontrada': 'Invoice not found',
  'Período de cobrança obrigatório para planos pagos':
    'A billing period is required for paid plans',
  'Plano gratuito não pode ser cancelado': 'The free plan cannot be canceled',
  'Redirecionando para pagamento do upgrade...':
    'Redirecting to the upgrade payment…',
  'Sem permissão para acessar esta nota fiscal':
    'No permission to access this invoice',
  'Você já está neste plano': 'You are already on this plan',
  'Escolha o plano a conceder': 'Choose the plan to grant',
  'Esta conta paga pelo Stripe: o plano muda pela própria assinatura':
    'This account pays through Stripe: the plan changes through its own subscription',
  'O vencimento do plano precisa ser futuro':
    'The plan expiry date must be in the future',
  'Você já possui uma assinatura ativa':
    'You already have an active subscription',
  'session_id ausente': 'Missing session_id',

  // Newsletter and contact
  'Token expirado. Inscreva-se novamente na newsletter.':
    'Expired token. Subscribe to the newsletter again.',
  'Bem-vindo de volta! Enviamos um e-mail de confirmação.':
    'Welcome back. We sent you a confirmation email.',
  'Email de confirmação reenviado com sucesso!': 'Confirmation email resent.',
  'Esta inscrição já foi cancelada anteriormente.':
    'This subscription was already canceled.',
  'Esta inscrição já foi confirmada anteriormente.':
    'This subscription was already confirmed.',
  'Este e-mail foi bloqueado. Entre em contato conosco.':
    'This email was blocked. Get in touch with us.',
  'Este e-mail já está ativo na newsletter.':
    'This email already gets the newsletter.',
  'Este e-mail já está inscrito na nossa newsletter.':
    'This email is already subscribed to our newsletter.',
  'Este e-mail já está pendente de confirmação.':
    'This email is already waiting for confirmation.',
  'Este e-mail já foi cadastrado mas ainda não foi confirmado. Verifique sua caixa de entrada.':
    'This email was signed up but not confirmed yet. Check your inbox.',
  'Este e-mail não está aguardando confirmação.':
    'This email is not waiting for confirmation.',
  'Este e-mail teve problemas de entrega anteriormente. Verifique se o endereço está correto.':
    'Delivery to this email failed before. Check that the address is right.',
  'Inscrição cancelada com sucesso.': 'Unsubscribed.',
  'Inscrição na newsletter confirmada com sucesso!':
    'Newsletter subscription confirmed.',
  'Inscrição não encontrada': 'Subscription not found',
  'Inscrição realizada! Verifique seu e-mail para confirmar.':
    'Subscribed. Check your email to confirm.',
  'Mensagem enviada com sucesso! Responderemos em breve.':
    'Message sent. We will reply soon.',

  // Blog, reader side
  'Artigo curtido': 'Article liked',
  'Artigo não encontrado': 'Article not found',
  'Artigo salvo': 'Article saved',
  'Autor não encontrado': 'Author not found',
  'Categoria não encontrada': 'Category not found',
  'Comentário apagado': 'Comment deleted',
  'Comentário atualizado': 'Comment updated',
  'Comentário não encontrado': 'Comment not found',
  'Comentário publicado': 'Comment posted',
  'Comentário removido. As respostas continuam na conversa.':
    'Comment removed. The replies stay in the thread.',
  'Comentário respondido não encontrado':
    'The comment being replied to was not found',
  'Curtida removida': 'Like removed',
  'Denúncia registrada. O comentário continua no ar até a análise.':
    'Report received. The comment stays up until it is reviewed.',
  'Denúncia registrada. O comentário saiu do ar enquanto a equipe analisa.':
    'Report received. The comment is down while the team reviews it.',
  'Este comentário está em análise ou saiu do ar, e não pode ser editado':
    'This comment is under review or was taken down, and cannot be edited',
  'Não dá para responder a um comentário que não está no ar':
    'You cannot reply to a comment that is not up',
  'Não dá para responder a um comentário removido':
    'You cannot reply to a removed comment',
  'Não é possível comentar em artigos não publicados':
    'You cannot comment on unpublished articles',
  'O comentário respondido não é deste artigo':
    'The comment being replied to is not from this article',
  'O período consultado passa de {0} dias':
    'The requested period is longer than {0} days',
  'Salvamento removido': 'Removed from saved',
  'Só quem escreveu pode editar o comentário':
    'Only the author can edit the comment',
  'Tag não encontrada': 'Tag not found',
  'Você não tem permissão para apagar este comentário':
    'You do not have permission to delete this comment',
  '`end` é anterior a `start`': '`end` is before `start`',
  'categoria é um slug (ex.: "romantico") ou "all"':
    'category is a slug (e.g. "romantico") or "all"',

  // Blog, article audio
  'O artigo não tem texto para ler': 'The article has no text to read',
  'O artigo tem {0} caracteres de texto; o áudio vai até {1}.':
    'The article has {0} characters of text; audio goes up to {1}.',
  'O áudio deste artigo ainda não foi gerado. Só a administração gera áudio.':
    'This article’s audio has not been made yet. Only the admins make audio.',
  'O áudio deste artigo teria uns {0} MB; o limite é {1} MB. {2}':
    'This article’s audio would be about {0} MB; the limit is {1} MB. {2}',
  'Use uma velocidade maior.': 'Use a faster speed.',
  'O texto é longo demais para um áudio só.':
    'The text is too long for a single audio.',
  'Áudio apagado': 'Audio deleted',
  'Áudio gerado ({0} pedaço(s))': 'Audio made ({0} part(s))',
  'Áudio já existe': 'The audio already exists',
  // Added 24/10/2026 (billing, achievements, year in review)
  'Conquista desbloqueada': 'Achievement unlocked',
  'Novas conquistas': 'New achievements',
  '{0} conquistas desbloqueadas': '{0} achievements unlocked',
  '{0} e mais {1}. Veja todas na sua página de conquistas.':
    '{0} and {1} more. See them all on your achievements page.',
  'Data forçada não vale em produção':
    'A forced date is not allowed in production',
  'Data inválida em "at"': 'Invalid date in "at"',
  'Há uma cobrança em atraso. Atualize o cartão em Meu perfil → Assinatura → Pagamento e faturas.':
    'A payment is overdue. Update your card in My profile → Subscription → Payment and invoices.',
  'Mudança agendada. Você continua no {0} até o fim do ciclo atual.':
    'Change scheduled. You keep {0} until the end of the current cycle.',
  'O cartão recusou a cobrança da diferença. Nada mudou: você continua no {0}. Atualize o cartão em Meu perfil → Assinatura → Pagamento e faturas e tente de novo.':
    'The card declined the difference. Nothing changed: you keep {0}. Update your card in My profile → Subscription → Payment and invoices and try again.',
  'Pronto: você continua no {0}. Nada muda na renovação.':
    'Done: you keep {0}. Nothing changes at renewal.',
  'Sua assinatura está cancelada. Reative-a antes de agendar outro plano.':
    'Your subscription is cancelled. Reactivate it before scheduling another plan.',
  'Sua assinatura foi cancelada, mas ainda vale até o fim do período. Para continuar, reative-a em Meu perfil → Assinatura.':
    'Your subscription was cancelled but stays active until the end of the period. To keep it, reactivate it in My profile → Subscription.',
  'Você já tem uma assinatura. Para mudar de plano, use Meu perfil → Assinatura.':
    'You already have a subscription. To change plans, use My profile → Subscription.',
  'Ainda faltam obras para o histórico: são precisas {0} entre "quero estudar" e "já aprendi" (ou 3 aprendidas).':
    'Your history needs more works: {0} between "want to learn" and "learned" (or 3 learned).',
  'O histórico visual é do Plus em diante.':
    'Visual history comes with Plus and above.',
  'Retrospectiva ainda não gerada': 'Year in review not generated yet',
  'Retrospectiva não encontrada': 'Year in review not found',
};
