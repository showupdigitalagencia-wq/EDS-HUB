{{-- 
  =============================================================================
  SNIPPET BLADE: Modificações para resources/views/register.blade.php
  =============================================================================
--}}

{{-- 
  -----------------------------------------------------------------------------
  ALTERAÇÃO 1: Campo Hidden para Rastreamento de Tentativa
  Local: Logo após a tag de abertura <form id="registerForm" ...>
  -----------------------------------------------------------------------------
--}}
<form id="registerForm" class="register-form" action="{{ route('register.submit') }}" method="POST" enctype="multipart/form-data" novalidate>
    @csrf
    
    {{-- CAMPO OBRIGATÓRIO PARA RASTREAMENTO EDS HUB --}}
    <input type="hidden" name="eds_form_attempt_id" id="eds_form_attempt_id" value="">

    {{-- ... restante dos campos do formulário (Personal Information, etc.) ... --}}
</form>



{{-- 
  -----------------------------------------------------------------------------
  ALTERAÇÃO 2: Carregamento do Script de Integração
  Local: No final da view Blade, antes do fechamento de </body> ou na seção @push('scripts')
  -----------------------------------------------------------------------------
--}}
@push('scripts')
    {{-- Script de Integração Oficial EDS HUB --}}
    <script src="{{ asset('js/eds-register-integration.js') }}" defer></script>
@endpush

{{-- Se a view não utilizar @push('scripts'), insira diretamente antes de </body>: --}}
{{-- <script src="{{ asset('js/eds-register-integration.js') }}" defer></script> --}}



{{-- 
  -----------------------------------------------------------------------------
  ALTERAÇÃO 3 (APENAS SE OPTAR PELA OPÇÃO A - PURO JAVASCRIPT NO FRONTEND):
  Se você NÃO for alterar o Controller Laravel (Opção B), adicione o hook no callback
  do fetch atual (por volta da linha 862 do script existente da página):
  -----------------------------------------------------------------------------
--}}
{{--
<script>
    // No seu fetch existente dentro do evento 'submit':
    fetch(form.action, {
        method: 'POST',
        body: data,
        credentials: 'same-origin',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json',
            'X-CSRF-TOKEN': csrfToken
        }
    }).then(function(res) {
        return res.json();
    }).then(function(result) {
        setLoading(false);
        if (result.success) {
            // HOOK EDS HUB: Notifica o CRM e redireciona em seguida
            if (typeof window.sendEdsHubCompletedForm === 'function') {
                window.sendEdsHubCompletedForm().finally(function() {
                    window.location.href = result.redirect || 'https://www.expdentalsolutions.com/thank-you';
                });
            } else {
                window.location.href = result.redirect || 'https://www.expdentalsolutions.com/thank-you';
            }
        } else if (result.errors) {
            // Em caso de erro de validação do Laravel, reporta a falha ao EDS HUB
            if (typeof window.reportEdsHubSubmissionFailure === 'function') {
                window.reportEdsHubSubmissionFailure('VALIDATION_422', 'Validation failed');
            }
            // ... restante do tratamento de exibição de erros existente ...
        }
    }).catch(function(err) {
        setLoading(false);
        // Em caso de erro de rede, reporta a falha ao EDS HUB
        if (typeof window.reportEdsHubSubmissionFailure === 'function') {
            window.reportEdsHubSubmissionFailure('NETWORK_ERROR', err.message || 'Network error');
        }
        showAlert('danger', 'Network error. Please try again.');
    });
</script>
--}}
