require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// 🕒 한국 시간(KST) 헬퍼 함수
function getKSTInfo() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).replace(/\. /g, '-').replace('.', '');

    const hourStr = now.toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        hour12: false
    });
    const currentHour = parseInt(hourStr, 10);

    return { today: todayStr, currentHour, nativeDate: now };
}

function getRemindMessage(hour) {
    if (hour === 11) return "좋은 아침이에요! 오늘도 잊지 말고 출근 도장 꾹 눌러주세요? ✨";
    if (hour === 14) return "벌써 오후 2시에요! 설마 오늘 출근 까먹으신 건 아니죠...? 얼른 오세요! 🤨";
    if (hour === 17) return "이제 해가 지려고 해요... 오늘 출근 안 하시면 연속 기록이 깨질지도 몰라요. 제발 와주세요. 😭";
    if (hour === 18) return "저기요... 아직도 안 오신 건가요? 6시예요. 이제 슬슬 걱정되기 시작하네요. 😟";
    if (hour === 19) return "7시입니다. 당신의 연속 출근 기록이 공중분해 되기 직전이에요. 지금 당장 오세요! ⚡";
    if (hour === 20) return "8시... 이제 제 목소리가 들리지 않나요? 당신의 성실함이 시험받고 있어요. ✊";
    if (hour === 21) return "9시예요. 이대로 포기하실 건가요? 지금까지 쌓아온 노력이 아깝지 않으세요? 😠";
    if (hour === 22) return "10시입니다. 이제 시간이 얼마 없어요. 제발... 마지막 기회일지도 몰라요. 🙏";
    if (hour === 23) return "11시!!! 이제 한 시간 뒤면 모든 게 끝납니다. 죽기 살기로 출근하세요! 빨리!!! 🚨🚨";
    return null;
}

// 🛡️ 재원이 대리 출근 공통 핵심 로직
async function runJaewonAttendance() {
    const { today } = getKSTInfo();
    const JAEWON_ID = "1152202483666538516";
    const JAEWON_NAME = "smphur08";

    const { data: user, error: selectError } = await supabase
        .from('attendance')
        .select('*')
        .eq('user_id', JAEWON_ID)
        .maybeSingle();

    if (selectError) throw selectError;

    if (user && user.last_checkin === today) {
        return { success: false, status: "ALREADY", reason: "이미 오늘 출근 처리가 되어 있습니다.", streak: user.streak };
    }

    let currentTokens = user ? (user.tokens ?? 200) : 200;
    if (currentTokens < 10) {
        return { success: false, status: "NO_TOKEN", reason: "보유 토큰이 부족합니다. (대리 출근에는 10 토큰이 필요합니다.)", streak: user ? user.streak : 0 };
    }

    currentTokens -= 10;

    let newStreak = 1;
    if (user && user.last_checkin) {
        const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
        const parts = formatter.formatToParts(new Date());
        const y = parts.find(p => p.type === 'year').value;
        const m = parts.find(p => p.type === 'month').value;
        const d = parts.find(p => p.type === 'day').value;
        
        const yesterday = new Date(`${y}-${m}-${d}T12:00:00+09:00`);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (user.last_checkin === yesterdayStr) {
            newStreak = (user.streak || 0) + 1;
        }
    }

    const currentCards = user ? (user.protection_cards ?? 0) : 0;

    await supabase.from('attendance').upsert({
        user_id: JAEWON_ID,
        username: JAEWON_NAME,
        last_checkin: today,
        streak: newStreak,
        tokens: currentTokens,
        protection_cards: currentCards
    }, { onConflict: 'user_id' });

    return { success: true, streak: newStreak, remainingTokens: currentTokens };
}

// 😈 [가변 확률 제어 엔진] 상금 정산 및 확률 유지/증가 처리
async function applySlotWinnings(message, userId, user, netPrize, resultText, slotDisplay, slotPrice, curseType = null) {
    let currentP444 = user.p_444 ?? 4.0;
    let currentP666 = user.p_666 ?? 1.0;

    let newP444 = currentP444;
    let newP666 = currentP666;

    if (curseType === '444') {
        newP444 = 4.0;
    } else if (curseType === '666') {
        newP666 = 1.0;
    } 
    // ✨ 돈을 잃거나(netPrize < 0) 본전일 때는 확률 증가 패스 (기존 확률 철저히 유지)
    else if (netPrize > 0) {
        newP444 = Math.min(currentP444 + 0.4, 99.0);
        newP666 = Math.min(currentP666 + 0.5, 99.0);
    }

    if (Math.floor(currentP444 / 10) < Math.floor(newP444 / 10)) {
        try {
            await message.author.send(`⚠️ **[경고]** 슬롯머신 과과금으로 인해 **444 사(死)의 저주 확률**이 **${Math.floor(newP444)}%**를 돌파했습니다!`);
        } catch (e) {}
    }
    if (Math.floor(currentP666 / 10) < Math.floor(newP666 / 10)) {
        try {
            await message.author.send(`💀 **[극비 경고]** 심연의 존재가 주시합니다. **666 지옥의 저주 확률**이 **${Math.floor(newP666)}%**를 돌파했습니다!`);
        } catch (e) {}
    }

    let finalTokens = (user.tokens ?? 200) + netPrize;
    if (finalTokens < 0) finalTokens = 0;
    finalTokens = Math.round(finalTokens * 100) / 100;

    await supabase.from('attendance').upsert({
        user_id: userId,
        username: message.author.username,
        tokens: finalTokens,
        protection_cards: user.protection_cards ?? 0,
        streak: user.streak ?? 0,
        last_checkin: user.last_checkin,
        p_444: newP444,
        p_666: newP666
    }, { onConflict: 'user_id' });

    let displayPrizeText = netPrize >= 0 ? `[ +${netPrize} 토큰 ]` : `[ ${netPrize} 토큰 ]`;

    return message.reply(
        `🎰 **SLOT MACHINE** 🎰\n` +
        `${slotDisplay}\n` +
        `-------------------------\n` +
        `${resultText}\n` +
        `💰 **정산:** 상금 및 변동 ${displayPrizeText} / 판돈 [ -${slotPrice} 토큰 ]\n` +
        `💳 **현재 잔액:** ${finalTokens} 토큰 (444: ${newP444.toFixed(1)}% | 666: ${newP666.toFixed(1)}%)`
    );
}

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);

    // ⏰ 재원이 자동 대리 출근 (23시)
    cron.schedule('0 23 * * *', async () => {
        try {
            const result = await runJaewonAttendance();
            if (result.success) {
                console.log(`✨ [자동완료] 23시 대리 출근 성공!`);
            }
        } catch (err) { console.error(err); }
    }, { timezone: "Asia/Seoul" });

    // 정각 알림 스케줄러
    cron.schedule('0 * * * *', async () => {
        const { today, currentHour } = getKSTInfo();
        const messageText = getRemindMessage(currentHour);
        if (messageText) {
            const { data: allUsers } = await supabase.from('attendance').select('*');
            if (allUsers) {
                for (const user of allUsers) {
                    if (user.last_checkin !== today) {
                        try {
                            const discordUser = await client.users.fetch(user.user_id);
                            await discordUser.send(`🔔 <@${user.user_id}>님! ${messageText}`);
                        } catch (err) {}
                    }
                }
            }
        }
    }, { timezone: "Asia/Seoul" });

    // 23시 59분 자동 방어권 소모 및 초기화
    cron.schedule('59 23 * * *', async () => {
        const { today } = getKSTInfo();
        const { data: allUsers } = await supabase.from('attendance').select('*');
        if (!allUsers) return;

        for (const user of allUsers) {
            if (user.last_checkin !== today && (user.streak || 0) > 0) {
                let cards = user.protection_cards || 0;
                if (cards > 0) {
                    cards -= 1;
                    await supabase.from('attendance').update({ protection_cards: cards }).eq('user_id', user.user_id);
                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`🛡️ 보호권이 사용되어 기록이 유지되었습니다! (남은 보호권: ${cards}개)`);
                    } catch (e) {}
                } else {
                    await supabase.from('attendance').update({ streak: 0 }).eq('user_id', user.user_id);
                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`💀 보호권이 없어 연속 출근 횟수가 초기화되었습니다.`);
                    } catch (e) {}
                }
            }
        }
    }, { timezone: "Asia/Seoul" });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const { today, currentHour } = getKSTInfo();

    if (message.content === "!재원") {
        try {
            await message.channel.sendTyping();
            const result = await runJaewonAttendance();
            if (result.success) {
                return message.reply(`🎯 **[수동 완료]** 대리 출근 성공! (잔여: 💰 \`${result.remainingTokens} 토큰\` / 🔥 연속 ${result.streak}일)`);
            } else {
                return message.reply(`ℹ️ **[스킵]** ${result.reason}`);
            }
        } catch (err) { return message.reply("❌ DB 처리 중 에러 발생"); }
    }

    if (message.content === "듀오링고") {
        const testMsg = getRemindMessage(currentHour);
        const finalMsg = testMsg ? testMsg : `현재 한국 시간 ${currentHour}시입니다.`;
        try {
            await message.author.send(`🧪 **[테스트 알림]**\n🔔 <@${userId}>님! ${finalMsg}`);
            return message.reply("성공! 개인 DM 확인 고고. 📩");
        } catch (err) { return message.reply("DM 전송 실패!"); }
    }

    if (message.content === "!상점") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const myTokens = user ? (user.tokens ?? 200) : 200;
            const myCards = user ? (user.protection_cards ?? 0) : 0;
            return message.reply(`🛒 **토큰 상점**\n👤 보유 토큰: 💰 \`${myTokens}\` | 보유 보호권: 🛡️ \`${myCards}개\`\n📦 **🛡️ 출근 횟수 보호권** | 가격: \`100 토큰\`\n👉 구매: \`!구매\` | 환불: \`!환불\` (수수료 제외 80토큰 반환)`);
        } catch (err) { return message.reply("상점 로드 실패."); }
    }

    if (message.content === "!구매") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;

            if (currentTokens < 100) return message.reply(`❌ 토큰 부족! (보유: 💰 \`${currentTokens}\`)`);

            await supabase.from('attendance').upsert({
                user_id: userId, username: message.author.username,
                tokens: currentTokens - 100, protection_cards: currentCards + 1,
                streak: user ? user.streak : 0, last_checkin: user ? user.last_checkin : null
            }, { onConflict: 'user_id' });

            return message.reply(`🛒 구매 완료! (잔여: 💰 \`${currentTokens - 100}\` | 보호권: 🛡️ \`${currentCards + 1}개\`)`);
        } catch (err) { return message.reply("구매 오류."); }
    }

    if (message.content === "!환불") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;

            if (currentCards < 1) return message.reply(`❌ 환불할 보호권이 없습니다.`);

            await supabase.from('attendance').upsert({
                user_id: userId, username: message.author.username,
                tokens: currentTokens + 80, protection_cards: currentCards - 1,
                streak: user ? user.streak : 0, last_checkin: user ? user.last_checkin : null
            }, { onConflict: 'user_id' });

            return message.reply(`💸 환불 완료! 80 토큰 반환. (현재 보유: 💰 \`${currentTokens + 80}\` | 보호권: 🛡️ \`${currentCards - 1}개\`)`);
        } catch (err) { return message.reply("환불 오류."); }
    }

    // =========================================================
    // 🎰 슬롯머신 도박 시스템 (5x3, 7x1 전면 개편)
    // =========================================================
    if (message.content === '!도박' || message.content === '!슬롯' || message.content === '!슬롯53' || message.content === '!슬롯7') {
        try {
            const slotPrice = 25;
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200, p_444: 4.0, p_666: 1.0 };
            
            if ((u.tokens ?? 200) < slotPrice) {
                return message.reply(`❌ 토큰이 부족합니다! 판돈은 **${slotPrice} 토큰**입니다.`);
            }

            const baseEmojis = ['7️⃣', '💎', '🍀', '🍇', '🍊', '🍒', '🔔'];
            const chance666 = (u.p_666 ?? 1.0) / 100;
            const chance444 = (u.p_444 ?? 4.0) / 100;

            const generateSymbol = () => {
                const rand = Math.random();
                if (rand < chance666) return '6️⃣';
                if (rand < chance666 + chance444) return '4️⃣';
                return baseEmojis[Math.floor(Math.random() * baseEmojis.length)];
            };

            // -----------------------------------------------------
            // Mode A: [!슬롯7] - 7열 1행 초고속 한 줄 다이렉트 도박판
            // -----------------------------------------------------
            if (message.content === '!슬롯7') {
                let row = Array.from({ length: 7 }, generateSymbol);
                let slotDisplay = `[ ${row.join(' | ')} ]`;
                
                const center = row[3];
                const count7 = row.filter(s => s === '7️⃣').length;
                const count6 = row.filter(s => s === '6️⃣').length;
                const count4 = row.filter(s => s === '4️⃣').length;

                let prize = 0;
                let curseType = null;
                let resultText = '';

                if (center === '7️⃣' && count7 >= 3) { prize = 400; resultText = '🔥 **[슬롯7 럭키마스터] 정중앙 7 안착 및 3성 정렬! (400토큰 획득)** 🔥'; }
                else if (count6 >= 3) { curseType = '666'; resultText = '💀 **[슬롯7 심연의 지배] 판 내에 6이 3개 이상 증식했습니다! (1500토큰 소멸)** 💀'; }
                else if (count4 >= 4) { curseType = '444'; resultText = '👁️ **[슬롯7 사계의 저주] 판 내에 4가 4개 이상 깔렸습니다! (444.4토큰 소멸)** 👁️'; }
                else if (center === '💎' || center === '7️⃣') { prize = 50; resultText = '✨ **[슬롯7 센터 조준] 핵심 코어에 고가치 심볼이 박혔습니다! (50토큰 획득)**'; }
                else if (new Set(row).size <= 3) { prize = 120; resultText = '🎉 **[슬롯7 고밀도 조합] 문양들이 모여서 압축 당첨! (120토큰 획득)** 🎉'; }
                else { prize = 5; resultText = '◽ **[슬롯7 소소] 소소한 과일 찌꺼기 보상입니다. (5토큰 획득)**'; }

                let netPrize = prize - slotPrice;
                if (curseType === '666') netPrize = -slotPrice - 1500;
                if (curseType === '444') netPrize = -slotPrice - 444.4;

                return applySlotWinnings(message, userId, u, netPrize, resultText, slotDisplay, slotPrice, curseType);
            }

            // -----------------------------------------------------
            // Mode B: [!슬롯53 / !도박 / !슬롯] - 5열 3행 완벽 격자 도박판
            // -----------------------------------------------------
            let matrix = [];
            let slotDisplay = '';
            for (let i = 0; i < 3; i++) {
                let row = Array.from({ length: 5 }, generateSymbol);
                matrix.push(row);
                slotDisplay += `[ ${row.join(' | ')} ]\n`;
            }

            let prize = 0;
            let curseType = null;
            let resultText = '';
            
            let allSymbols = matrix.flat();
            const total6 = allSymbols.filter(s => s === '6️⃣').length;
            const total4 = allSymbols.filter(s => s === '4️⃣').length;

            const row1Set = new Set(matrix[0]);
            const row2Set = new Set(matrix[1]);
            const row3Set = new Set(matrix[2]);

            if (total6 >= 5) {
                curseType = '666';
                resultText = '💀☠️ **[5x3 대재앙] 보드 전체가 지옥의 숫자로 오염되었습니다!!! 1500토큰이 강제 소멸합니다!** ☠️💀';
            } else if (total4 >= 6) {
                curseType = '444';
                resultText = '👁️🚨 **[5x3 죽음의 낙인] 사(死)의 에너지가 폭발합니다! 444.4토큰이 영구 차감됩니다!** 🚨👁️';
            } else if (row2Set.size === 1) { 
                const sym = matrix[1][0];
                if (sym === '7️⃣') { prize = 1200; resultText = '🔥👑 **[5x3 신화 잭팟] 중앙 77777 일렬 종대 달성!!! 전설의 귀환! (1200토큰 획득)** 👑🔥'; }
                else if (sym === '💎') { prize = 800; resultText = '💎✨ **[5x3 전설 잭팟] 중앙 다이아몬드 풀 크리스탈 라인업! (800토큰 획득)** ✨💎'; }
                else { prize = 400; resultText = `🎰 **[5x3 미들 잭팟] 중앙 가로라인 일치! [ ${sym} ] (400토큰 획득)** 🎰`; }
            } else if (row1Set.size === 1 || row3Set.size === 1) { 
                prize = 250;
                resultText = '🎉 **[5x3 사이드 라인] 상단 혹은 하단 가로 한 줄이 완벽히 통일되었습니다! (250토큰 획득)** 🎉';
            } else {
                const corners = [matrix[0][0], matrix[0][4], matrix[2][0], matrix[2][4]];
                const cornerSet = new Set(corners);
                if (cornerSet.size === 1 && !corners.includes('4️⃣') && !corners.includes('6️⃣')) {
                    prize = 150;
                    resultText = '🍀✨ **[5x3 모서리 크로스] 네 꼭짓점의 문양이 소름 돋게 일치합니다! (150토큰 획득)** ✨🍀';
                } else {
                    const maxMatches = Math.max(...baseEmojis.map(e => allSymbols.filter(s => s === e).length));
                    if (maxMatches >= 6) { prize = 60; resultText = `📈 **[5x3 밀집 당첨] 한 종류의 문양이 6개 이상 모였습니다! (60토큰 획득)**`; }
                    else if (maxMatches >= 4) { prize = 20; resultText = `🎉 **[5x3 일반 당첨] 나란히 모인 문양들이 보상을 줍니다. (20토큰 획득)**`; }
                    else { prize = 0; resultText = '😭 **[5x3 낙첨] 격자를 맞추지 못했습니다. 다음 기회에 도전하세요!** 😭'; }
                }
            }

            let netPrize = prize - slotPrice;
            if (curseType === '666') netPrize = -slotPrice - 1500;
            if (curseType === '444') netPrize = -slotPrice - 444.4;

            return applySlotWinnings(message, userId, u, netPrize, resultText, slotDisplay, slotPrice, curseType);

        } catch (err) {
            console.error(err);
            return message.reply("5x3 대형 격자 슬롯머신 구동 실패.");
        }
    }

    // -----------------------------------------------------
    // Mode C: [!슬롯35] - 15칸 뒤집기 스페셜 도박판 생성
    // -----------------------------------------------------
    if (message.content === '!슬롯35') {
        try {
            const slotPrice = 25;
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200 };

            if ((u.tokens ?? 200) < slotPrice) return message.reply(`❌ 토큰이 부족합니다!`);

            const baseEmojis = ['7️⃣', '💎', '🍀', '🍇', '🍊', '🍒', '🔔'];
            const chance666 = (u.p_666 ?? 1.0) / 100;
            const chance444 = (u.p_444 ?? 4.0) / 100;

            const hiddenBoard = Array.from({ length: 15 }, () => {
                const rand = Math.random();
                if (rand < chance666) return '6️⃣';
                if (rand < chance666 + chance444) return '4️⃣';
                return baseEmojis[Math.floor(Math.random() * baseEmojis.length)];
            });

            if (!client.slot35Data) client.slot35Data = new Map();
            client.slot35Data.set(userId, { hiddenBoard, timestamp: Date.now() });

            return message.reply(
                `🎲 **[슬롯35: 스페셜 뒤집기 도박판]** 판돈 **25 토큰** 대기 완료.\n` +
                `아래 15개의 뒷면 카드 중 대박 상금이 숨겨진 **3개의 번호**를 찍으세요!\n\n` +
                `1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣\n6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟\n⑪ ⑫ ⑬ ⑭ ⑮\n\n` +
                `👉 **명령어:** \`!선택 3 7 12\` (공백으로 구분된 1~15 사이 숫자 3개)`
            );
        } catch (e) { return message.reply("슬롯35 생성 실패."); }
    }

    if (message.content.startsWith('!선택')) {
        try {
            if (!client.slot35Data || !client.slot35Data.has(userId)) {
                return message.reply("❌ 먼저 \`!슬롯35\`로 도박판 판때기를 먼저 생성해야 합니다!");
            }

            const args = message.content.split(' ').slice(1);
            if (args.length !== 3) return message.reply("❌ 정확히 3개의 카드 번호를 입력하세요! 예: \`!선택 1 9 15\`");

            const chosenIndices = args.map(num => parseInt(num, 10) - 1);
            const isValid = chosenIndices.every(idx => idx >= 0 && idx < 15 && !isNaN(idx));
            const isUnique = new Set(chosenIndices).size === 3;

            if (!isValid || !isUnique) return message.reply("❌ 1부터 15 사이의 중복 없는 올바른 보드 인덱스를 고르셔야 합니다.");

            const session = client.slot35Data.get(userId);
            client.slot35Data.delete(userId); 

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200, p_444: 4.0, p_666: 1.0 };

            const s1 = session.hiddenBoard[chosenIndices[0]];
            const s2 = session.hiddenBoard[chosenIndices[1]];
            const s3 = session.hiddenBoard[chosenIndices[2]];

            let prize = 0;
            let curseType = null;
            let resultText = '';
            const slotDisplay = `🎰 **선택 카드 뒤집기 결과:** [ ${s1} | ${s2} | ${s3} ]`;

            if (s1 === '6️⃣' && s2 === '6️⃣' && s3 === '6️⃣') {
                curseType = '666'; resultText = '💀 **[슬롯35 대재앙] 6 6 6 무덤 리빌! 1500토큰이 증발합니다!** 💀';
            } else if (s1 === '4️⃣' && s2 === '4️⃣' && s3 === '4️⃣') {
                curseType = '444'; resultText = '👁️ **[슬롯35 사선 오픈] 4 4 4 금기 봉인 해제! 444.4토큰 소멸!** 👁️';
            } else if (s1 === s2 && s2 === s3) {
                if (s1 === '7️⃣') { prize = 1500; resultText = '🔥 **[슬롯35 신화 트리플] 황금의 손가락! 777 저격 완료! (1500토큰 획득)** 🔥'; }
                else if (s1 === '💎') { prize = 900; resultText = '💎 **[슬롯35 쥬얼 트리플] 다이아몬드 광맥 채굴 성공! (900토큰 획득)** 💎'; }
                else { prize = 150; resultText = `🎰 **[슬롯35 일반 트리플] 골라잡은 트리플 라인! (150토큰 획득)** 🎰`; }
            } else if ((s1 === s2 || s2 === s3 || s1 === s3) && s1 !== '6️⃣' && s2 !== '6️⃣' && s3 !== '6️⃣' && s1 !== '4️⃣' && s2 !== '4️⃣' && s3 !== '4️⃣') {
                prize = 30; resultText = '🎉 **[슬롯35 페어 매치] 2개의 카드가 일치하여 소소하게 방어 성공! (30토큰 획득)** 🎉';
            } else {
                prize = 0; resultText = '😭 **[슬롯35 낙첨] 카드들이 서로 엇갈렸습니다. 감이 부족했네요!** 😭';
            }

            const slotPrice = 25;
            let netPrize = prize - slotPrice;
            if (curseType === '666') netPrize = -slotPrice - 1500;
            if (curseType === '444') netPrize = -slotPrice - 444.4;

            return applySlotWinnings(message, userId, u, netPrize, resultText, slotDisplay, slotPrice, curseType);

        } catch (err) { console.error(err); return message.reply("슬롯35 선택 처리기 가동 실패."); }
    }

    // =========================================================
    // 🎫 추가 기능: 로또 (!로또 수동/자동)
    // =========================================================
    if (message.content.startsWith('!로또')) {
        try {
            const args = message.content.split(' ').slice(1);
            const isAuto = (args[0] === '자동' || args.length === 0);
            const lottoPrice = isAuto ? 55 : 50; 

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;

            if (currentTokens < lottoPrice) return message.reply(`❌ 토큰 부족! 잔액: ${currentTokens} 토큰`);

            let userNumbers = [];
            if (isAuto) {
                while (userNumbers.length < 6) {
                    let num = Math.floor(Math.random() * 45) + 1;
                    if (!userNumbers.includes(num)) userNumbers.push(num);
                }
            } else {
                if (args.length !== 6) return message.reply(`❌ \`!로또 3 12 24 33 39 45\` 형태로 번호 6개를 치거나 \`!로또 자동\`을 치세요!`);
                userNumbers = args.map(Number);
                if (userNumbers.some(num => num < 1 || num > 45 || isNaN(num)) || new Set(userNumbers).size !== 6) {
                    return message.reply('❌ 올바르지 않은 마킹 번호 리스트입니다.');
                }
            }
            userNumbers.sort((a, b) => a - b);

            let winningNumbers = [];
            while (winningNumbers.length < 6) {
                let num = Math.floor(Math.random() * 45) + 1;
                if (!winningNumbers.includes(num)) winningNumbers.push(num);
            }
            winningNumbers.sort((a, b) => a - b);

            let bonusNumber;
            while (true) {
                let num = Math.floor(Math.random() * 45) + 1;
                if (!winningNumbers.includes(num)) { bonusNumber = num; break; }
            }

            const matchedCount = userNumbers.filter(num => winningNumbers.includes(num)).length;
            const isBonusMatched = userNumbers.includes(bonusNumber);

            let resultMessage = '😭 낙첨... 다음 회차에!';
            let prize = 0;

            if (matchedCount === 6) { resultMessage = '🎉 1등 대박 잭팟!!! 🎉'; prize = 5000; }
            else if (matchedCount === 5 && isBonusMatched) { resultMessage = '🥈 2등 보너스 적중!! 🥈'; prize = 1000; }
            else if (matchedCount === 5) { resultMessage = '🥉 3등 당첨! 고액 보상! 🥉'; prize = 500; }
            else if (matchedCount === 4) { resultMessage = '🏅 4등 당첨! 피자 값 확보! 🏅'; prize = 100; }
            else if (matchedCount === 3) { resultMessage = '◽ 5등 당첨! 본전 수거! ◽'; prize = 25; }

            const finalTokens = currentTokens - lottoPrice + prize;
            await supabase.from('attendance').update({ tokens: finalTokens }).eq('user_id', userId);

            return message.reply(
                `🎫 **인생역전 로또 영수증** 🎫\n` +
                `• 선택 번호: [ ${userNumbers.join(', ')} ]\n` +
                `• 당첨 번호: [ ${winningNumbers.join(', ')} ] + 보너스 [ ${bonusNumber} ]\n` +
                `-----------------------------------------\n` +
                `🎯 결과: ${resultMessage} (맞춘 개수: ${matchedCount}개)\n` +
                `💰 변동: 상금 [ +${prize} ] / 판돈 [ -${lottoPrice} ] | 잔액: ${finalTokens} 토큰`
            );
        } catch (err) { return message.reply("로또 구동 실패."); }
    }

    if (message.content !== "출근" && message.content !== "근출" && message.content !== "출" && message.content !== "근" && message.content !== "出勤" && message.content !== "ㅊㄱ" && message.content !== "출첵" && message.content !== "출석" && message.content !== "attend" && message.content !== "근." && message.content !== "출." && message.content !== "출 " && message.content !== "근 " && message.content !== "출군" && message.content !== "앙" && message.content !== "아잉" && message.content !== "웅" && message.content !== "출근해떠염" && message.content !== "여자" && message.content !== "ㅊㅊ" && message.content !== "시기다른래퍼들의반대편을바라보던래퍼들의배포") return;

    if (currentHour >= 0 && currentHour < 4) {
        return message.reply("🚫 지금은 출근 자금 세탁 금지 시간입니다! 아침 일찍 오세요!");
    }

    try {
        const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
        if (user && user.last_checkin === today) return message.reply(`오늘 이미 도장을 찍었습니다! ✨`);

        let earnedTokens = 10;
        if (currentHour < 14) earnedTokens = 20;
        else if (currentHour < 18) earnedTokens = 15;

        let newStreak = 1;
        if (user && user.last_checkin) {
            const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
            const parts = formatter.formatToParts(new Date());
            const yesterday = new Date(`${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}T12:00:00+09:00`);
            yesterday.setDate(yesterday.getDate() - 1);
            if (user.last_checkin === yesterday.toISOString().split('T')[0]) newStreak = (user.streak || 0) + 1;
        }

        const totalTokens = (user ? (user.tokens ?? 200) : 200) + earnedTokens;
        await supabase.from('attendance').upsert({
            user_id: userId, username: message.author.username,
            last_checkin: today, streak: newStreak, tokens: totalTokens,
            protection_cards: user ? (user.protection_cards ?? 0) : 0
        }, { onConflict: 'user_id' });

        return message.reply(`✅ **출근 체크 성공!** 현재 **${newStreak}일** 연속 달리는 중! 🔥\n💰 \`${earnedTokens} 토큰\` 지급 (총액: \`${totalTokens} 토큰\`)`);
    } catch (err) { return message.reply("⚠️ 출근 DB 처리 에러 발생!"); }
});

client.login(process.env.DISCORD_TOKEN);
