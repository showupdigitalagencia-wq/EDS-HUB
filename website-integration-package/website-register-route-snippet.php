<?php

/**
 * =============================================================================
 * SNIPPET DE ROTAS: routes/web.php
 * =============================================================================
 * Configuração das rotas de exibição, submissão e agradecimento do formulário.
 */

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\RegisterController;

// Rota de exibição da página de registro
Route::get('/register', [RegisterController::class, 'showRegistrationForm'])->name('register');

// Rota de submissão do formulário (POST)
Route::post('/register', [RegisterController::class, 'submit'])->name('register.submit');

// Rota da página de confirmação / obrigado
Route::get('/thank-you', function () {
    return view('thank-you');
})->name('thankyou');
