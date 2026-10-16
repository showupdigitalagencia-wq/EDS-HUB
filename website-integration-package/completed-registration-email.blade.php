<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>[EDS] Nova matrícula concluída — {{ $registration->name ?? 'Aluno' }}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .eds-container { width: 100% !important; max-width: 100% !important; }
      .eds-content-padding { padding: 16px !important; }
      .eds-lead-name { font-size: 18px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <!-- Preheader text for email preview -->
  <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #f8fafc;">
    Nova matrícula concluída — {{ $registration->name ?? 'Aluno' }} — {{ $registration->course ?? 'Curso Confirmado' }}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8fafc; padding: 24px 8px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="eds-container" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
          
          <!-- Brand Header -->
          <tr>
            <td style="padding: 24px 28px 18px 28px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; text-align: left;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="vertical-align: middle;">
                    <a href="https://www.expdentalsolutions.com" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img src="https://www.expdentalsolutions.com/storage/site/fJOJt2KVIZpwj4mHb7QQ.png" alt="Expert Dental Solutions" width="150" style="display: block; width: 150px; max-width: 150px; height: auto; border: 0;" />
                    </a>
                    <div style="font-size: 12px; font-weight: 700; color: #08254f; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 6px;">
                      Expert Dental Solutions
                    </div>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; background-color: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; border-radius: 12px;">
                      Matrícula Confirmada
                    </span>
                  </td>
                </tr>
              </table>
              <div style="margin-top: 14px; font-size: 18px; font-weight: 700; color: #08254f; line-height: 1.3;">
                Nova matrícula concluída
              </div>
            </td>
          </tr>

          <!-- Lead Summary Highlight Card -->
          <tr>
            <td style="padding: 20px 28px 0 28px;" class="eds-content-padding">
              <div style="background-color: #f8fafc; border-left: 4px solid #10b981; border-radius: 6px; padding: 14px 18px;">
                <div class="eds-lead-name" style="font-size: 19px; font-weight: 700; color: #0f172a; line-height: 1.2;">
                  {{ $registration->name ?? 'Aluno' }}
                </div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
                  Inscrição finalizada com sucesso no site oficial
                </div>
                @if(!empty($registration->course))
                <div style="margin-top: 8px; font-size: 13px; font-weight: 600; color: #08254f;">
                  <span style="display: inline-block; padding: 2px 8px; background-color: #e0e7ff; color: #3730a3; border-radius: 4px; font-size: 11px; margin-right: 6px; text-transform: uppercase;">Curso</span>
                  {{ $registration->course }}
                </div>
                @endif
                @if(!empty($registration->turma))
                <div style="margin-top: 4px; font-size: 12px; color: #475569;">
                  <span style="display: inline-block; padding: 2px 8px; background-color: #f1f5f9; color: #475569; border-radius: 4px; font-size: 11px; margin-right: 6px; text-transform: uppercase;">Turma</span>
                  {{ $registration->turma }}
                </div>
                @endif
              </div>
            </td>
          </tr>

          <!-- Structured Sections -->
          <tr>
            <td style="padding: 0 28px 24px 28px;" class="eds-content-padding">

              <!-- DADOS DO ALUNO -->
              <div style="margin-top: 22px;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; margin-bottom: 8px;">
                  Dados do Aluno
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 4px;">
                  <tbody>
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Nome Completo</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->name ?? 'Não informado' }}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">E-mail</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">
                        @if(!empty($registration->email))
                          <a href="mailto:{{ $registration->email }}" style="color: #08254f; text-decoration: underline;">{{ $registration->email }}</a>
                        @else
                          Não informado
                        @endif
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Telefone</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->phone ?? 'Não informado' }}</td>
                    </tr>
                    @if(!empty($registration->emergency_phone))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Tel. Emergência</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->emergency_phone }}</td>
                    </tr>
                    @endif
                    @if(!empty($registration->certificate_name))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Nome no Certificado</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->certificate_name }}</td>
                    </tr>
                    @endif
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Data de Conclusão</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ now()->format('d/m/Y H:i:s') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- CURSO & TURMA -->
              <div style="margin-top: 22px;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; margin-bottom: 8px;">
                  Curso &amp; Turma
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 4px;">
                  <tbody>
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Curso Selecionado</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->course ?? 'Curso Confirmado' }}</td>
                    </tr>
                    @if(!empty($registration->turma))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Turma / Datas</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->turma }}</td>
                    </tr>
                    @endif
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Termos e Condições</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">Aceito pelo candidato</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- INFORMAÇÕES PROFISSIONAIS -->
              <div style="margin-top: 22px;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; margin-bottom: 8px;">
                  Informações Profissionais
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 4px;">
                  <tbody>
                    @if(!empty($registration->specialty))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Especialidade</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->specialty }}</td>
                    </tr>
                    @endif
                    @if(!empty($registration->years_in_practice))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Anos de Prática</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->years_in_practice }}</td>
                    </tr>
                    @endif
                    @if(!empty($registration->surgical_experience))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Exp. Cirúrgica</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->surgical_experience }}</td>
                    </tr>
                    @endif
                    @if(!empty($registration->agd_number))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Número AGD/PACE</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->agd_number }}</td>
                    </tr>
                    @endif
                    @if(!empty($registration->coat_size))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Tamanho do Jaleco</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->coat_size }}</td>
                    </tr>
                    @endif
                  </tbody>
                </table>
              </div>

              <!-- DOCUMENTOS & ANEXOS -->
              <div style="margin-top: 22px;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; margin-bottom: 8px;">
                  Documentos &amp; Anexos de Matrícula
                </div>
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px;">
                  <ul style="margin: 0; padding-left: 20px; color: #0f172a; font-size: 13px; line-height: 1.6;">
                    <li><strong>Passaporte / Documento de Identificação:</strong> Arquivo físico anexado a esta mensagem.</li>
                    <li><strong>Licença Odontológica / Dental Licence:</strong> Arquivo físico anexado a esta mensagem.</li>
                  </ul>
                  <p style="margin: 10px 0 0 0; font-size: 11px; color: #64748b;">
                    Estes arquivos foram validados no formulário de registro e estão anexados diretamente neste e-mail para conferência da equipe de admissões.
                  </p>
                </div>
              </div>

              <!-- ORIGEM & ATRIBUIÇÃO -->
              <div style="margin-top: 22px;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #08254f; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; margin-bottom: 8px;">
                  Origem &amp; Atribuição
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-top: 4px;">
                  <tbody>
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Origem</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">Website (Formulário Oficial de Registro)</td>
                    </tr>
                    @if(!empty($registration->heard_from))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Onde Conheceu</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">
                        {{ $registration->heard_from }}
                        @if(!empty($registration->referral_name))
                          (Indicação: {{ $registration->referral_name }})
                        @endif
                      </td>
                    </tr>
                    @endif
                    @if(!empty($registration->promo_code))
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Cupom Aplicado</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">{{ $registration->promo_code }}</td>
                    </tr>
                    @endif
                    <tr>
                      <td style="padding: 8px 12px; font-size: 13px; color: #64748b; width: 36%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 500;">Página</td>
                      <td style="padding: 8px 12px; font-size: 13px; color: #0f172a; width: 64%; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-weight: 600;">https://www.expdentalsolutions.com/register</td>
                    </tr>
                  </tbody>
                </table>
              </div>

            </td>
          </tr>

          <!-- Operational Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 28px; text-align: center;">
              <div style="font-size: 12px; font-weight: 700; color: #08254f;">
                Expert Dental Solutions
              </div>
              <div style="font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.4;">
                Notificação operacional oficial de matrícula recebida via website.
              </div>
              <div style="font-size: 10px; color: #94a3b8; margin-top: 6px;">
                3730 S Federal Hwy, Boynton Beach, FL 33435 &bull; info@expdentalsolutions.com
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
